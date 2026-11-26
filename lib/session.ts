// Signed sign-in cookie for team members. The token carries the member id and
// their session version; the server re-checks both against the database (see
// lib/viewer.ts), so disabling someone or resetting a password signs them out
// everywhere at once. Web Crypto only, so it runs anywhere.

export const USER_SESSION_COOKIE = "mmg_user_session";
export const USER_SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours, same as the shared-password session

export interface SessionClaims {
  uid: number;
  sv: number; // session version
  exp: number; // unix seconds
}

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.DASHBOARD_PASSWORD;
  if (s) return `mmg-team-session:v1:${s}`;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not configured");
  return "mmg-team-session:v1:dev-only";
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export async function signSession(uid: number, sv: number): Promise<string> {
  const claims: SessionClaims = { uid, sv, exp: Math.floor(Date.now() / 1000) + USER_SESSION_MAX_AGE };
  const body = b64url(enc.encode(JSON.stringify(claims)));
  return `v1.${body}.${await hmac(body)}`;
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  const [v, body, sig] = token.split(".");
  if (v !== "v1" || !body || !sig) return null;
  const expected = await hmac(body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionClaims;
    if (!Number.isInteger(claims.uid) || !Number.isInteger(claims.sv) || claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: USER_SESSION_MAX_AGE,
};
