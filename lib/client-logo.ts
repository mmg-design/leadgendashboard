import { createHash } from "node:crypto";
import type { ClientConfig } from "./clients";

// Where a client's logo is served, versioned so a new logo busts the cache. Null without one.
export function logoUrl(c: Pick<ClientConfig, "slug" | "iconUrl">): string | null {
  if (!c.iconUrl) return null;
  const v = createHash("sha1").update(c.iconUrl).digest("hex").slice(0, 10);
  return `/api/clients/logo/${encodeURIComponent(c.slug)}?v=${v}`;
}
