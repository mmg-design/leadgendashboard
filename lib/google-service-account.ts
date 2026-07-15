import fs from "fs";
import path from "path";

// Same credential sources as the GA4 API routes: env var in production, local key file in dev.
export function getGoogleServiceAccountEmail(): string | null {
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    try {
      const json = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString();
      return JSON.parse(json).client_email ?? null;
    } catch {
      return null;
    }
  }

  const credPath = path.join(process.cwd(), "web-lead-gen-mvp-97217b4d6543.json");
  if (fs.existsSync(credPath)) {
    try {
      return JSON.parse(fs.readFileSync(credPath, "utf-8")).client_email ?? null;
    } catch {
      return null;
    }
  }

  return null;
}
