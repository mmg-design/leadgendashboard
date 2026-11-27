import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// AES-256-GCM for secrets the dashboard keeps in its database (the GitHub
// app's private key). The key comes from server env, so a copy of the
// database alone can't be used. APP_ENCRYPTION_KEY wins if it's ever set;
// otherwise it's derived from the Google OAuth client secret, which never changes.

function key(label: string) {
  const base = process.env.APP_ENCRYPTION_KEY || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  return createHash("sha256").update(`${base}:mmg-${label}`).digest();
}

export function seal(text: string, label: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(label), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function open(blob: string, label: string): string {
  const [iv, tag, body] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(label), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
