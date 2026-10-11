import sharp from "sharp";
import { getDb } from "./db";

// Homepage screenshots for the client cards on the home page. thum.io takes the
// shot (it waits for Webflow's fade-in animations, which other free services
// catch half-drawn); we shrink it to a small JPEG and keep it in the database
// for a day, so the home page never waits on thum.io and makes ~1 request per
// client per day.

const MAX_AGE_HOURS = 24;

async function capture(domain: string): Promise<Buffer> {
  const site = `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const res = await fetch(`https://image.thum.io/get/width/1280/crop/800/wait/4/noanimate/${site}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) {
    throw new Error(`thum.io ${res.status}`);
  }
  const png = Buffer.from(await res.arrayBuffer());
  return sharp(png).resize({ width: 800 }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
}

export async function sitePreview(slug: string, domain: string, fresh = false): Promise<Buffer | null> {
  const db = await getDb();
  const cached = await db.execute({
    sql: `SELECT data, fetched_at > datetime('now', ?) AS current FROM analytics_cache
          WHERE client_slug = ? AND metric_type = 'site_preview' AND date_range = ?`,
    args: [`-${MAX_AGE_HOURS} hours`, slug, domain],
  });
  const row = cached.rows[0];
  if (row && Number(row.current) === 1 && !fresh) return Buffer.from(row.data as string, "base64");

  try {
    const jpeg = await capture(domain);
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'site_preview', ?, ?, datetime('now'))`,
      args: [slug, domain, jpeg.toString("base64")],
    });
    return jpeg;
  } catch (err) {
    console.error(`Site preview failed for ${domain}:`, err);
    // An old screenshot beats an empty card.
    return row ? Buffer.from(row.data as string, "base64") : null;
  }
}
