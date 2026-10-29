import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getDb } from "./db";

// "Connect Gmail": a Google sign-in that lets MMG Pulse save drafts in the
// team member's own Gmail (gmail.compose, which can't read the inbox).
// Nothing is sent; drafts wait in Gmail until a person sends them.
//
// Needs an OAuth client (Web application) in Google Cloud with the Gmail API
// enabled and the consent screen set to Internal, plus GOOGLE_OAUTH_CLIENT_ID
// and GOOGLE_OAUTH_CLIENT_SECRET in the environment.

export const GMAIL_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.compose"];
const CONNECTION_ID = "gmail";

export function oauthConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function redirectUri(origin: string) {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || `${origin}/api/google/callback`;
}

export function authUrl(origin: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token, even on reconnect
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// AES-256-GCM with a key derived from the OAuth client secret, so a database
// copy alone can't be used to write to the mailbox.
function key() {
  return createHash("sha256").update(`${process.env.GOOGLE_OAUTH_CLIENT_SECRET || ""}:mmg-pulse-gmail`).digest();
}
function encrypt(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
function decrypt(blob: string) {
  const [iv, tag, body] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      ...params,
    }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || "Google sign-in failed");
  return json as { access_token: string; refresh_token?: string; id_token?: string; scope: string };
}

export async function finishConnect(code: string, origin: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!tokens.refresh_token) throw new Error("Google didn't return a refresh token. Try connecting again.");
  if (!tokens.scope.includes("gmail.compose")) throw new Error("Gmail permission wasn't granted. Connect again and allow drafts.");
  // The ID token comes straight from Google's token endpoint over TLS, so its payload can be read as is.
  const claims = tokens.id_token ? JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) : {};
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO google_connections (id, email, name, scopes, refresh_token, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    args: [CONNECTION_ID, claims.email || "", claims.name || null, tokens.scope, encrypt(tokens.refresh_token)],
  });
  return { email: claims.email as string | undefined };
}

export interface GmailConnection { email: string; name: string | null }

export async function getConnection(): Promise<GmailConnection | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT email, name FROM google_connections WHERE id = ?", args: [CONNECTION_ID] });
  return res.rows[0] ? { email: res.rows[0].email as string, name: (res.rows[0].name as string) || null } : null;
}

async function accessToken() {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT refresh_token FROM google_connections WHERE id = ?", args: [CONNECTION_ID] });
  if (!res.rows[0]) throw new Error("Gmail isn't connected.");
  let refresh: string;
  try { refresh = decrypt(res.rows[0].refresh_token as string); } catch { throw new Error("The Gmail connection needs to be set up again."); }
  return (await tokenRequest({ refresh_token: refresh, grant_type: "refresh_token" })).access_token;
}

// Revokes the token at Google too, so the permission disappears from the account.
export async function disconnect() {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT refresh_token FROM google_connections WHERE id = ?", args: [CONNECTION_ID] });
  if (res.rows[0]) {
    try {
      const token = decrypt(res.rows[0].refresh_token as string);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
    } catch { /* already invalid */ }
  }
  await db.execute({ sql: "DELETE FROM google_connections WHERE id = ?", args: [CONNECTION_ID] });
}

// RFC 2047 for non-ASCII subjects and names (curly quotes, em dashes).
const header = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);

export async function createDraft(input: { to: string; subject: string; body: string }) {
  const token = await accessToken();
  const mime = [
    `To: ${input.to.replace(/[\r\n]/g, "")}`,
    `Subject: ${header(input.subject.replace(/[\r\n]/g, " "))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: Buffer.from(mime).toString("base64url") } }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    if (res.status === 403 && /has not been used|disabled/i.test(json.error?.message || "")) throw new Error("The Gmail API is turned off in the Google Cloud project. Enable it and try again.");
    throw new Error(json.error?.message || "Gmail didn't accept the draft.");
  }
  return { id: json.id as string, messageId: json.message?.id as string | undefined };
}
