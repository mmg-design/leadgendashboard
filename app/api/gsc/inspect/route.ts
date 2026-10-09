import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";
import { GscError, inspectUrl, resolveProperty, type IndexStatus } from "@/lib/gsc";

// Index status for a handful of pages. Google allows ~2,000 inspections per
// property per day, so each URL's result is kept for a day.
const MAX_URLS = 12;
const CONCURRENCY = MAX_URLS; // each inspection takes ~8s at Google, so run them together

export async function POST(req: NextRequest) {
  const { client: slug, urls, fresh } = (await req.json()) as { client?: string; urls?: string[]; fresh?: boolean };
  if (!slug || !Array.isArray(urls)) return NextResponse.json({ error: "Missing client or urls" }, { status: 400 });

  const config = await getClient(slug);
  const property = config ? await resolveProperty(config).catch(() => null) : null;
  if (!property) return NextResponse.json({ status: "not_configured", results: {} });

  const db = await getDb();
  const results: Record<string, IndexStatus> = {};

  try {
    const wanted = urls.slice(0, MAX_URLS);
    const toInspect: string[] = [];
    for (const url of wanted) {
      if (!fresh) {
        const cached = await db.execute({
          sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'gsc_inspect' AND date_range = ?
                AND fetched_at > datetime('now', '-24 hours')`,
          args: [slug, url],
        });
        if (cached.rows.length > 0) {
          results[url] = JSON.parse(cached.rows[0].data as string);
          continue;
        }
      }
      toInspect.push(url);
    }

    // In parallel: one-by-one took 30s+ for a first visit in production, and
    // Google allows 600 inspections a minute per property.
    for (let i = 0; i < toInspect.length; i += CONCURRENCY) {
      const batch = toInspect.slice(i, i + CONCURRENCY);
      const statuses = await Promise.all(batch.map((url) => inspectUrl(property, url)));
      for (const [j, status] of statuses.entries()) {
        results[batch[j]] = status;
        await db.execute({
          sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
                VALUES (?, 'gsc_inspect', ?, ?, datetime('now'))`,
          args: [slug, batch[j], JSON.stringify(status)],
        });
      }
    }
    return NextResponse.json({ status: "ok", results });
  } catch (err) {
    // Keep whatever finished before the failure.
    if (err instanceof GscError) return NextResponse.json({ status: err.kind, message: err.message, results });
    console.error("URL inspection error:", err);
    return NextResponse.json({ status: "error", message: "Couldn't check index status.", results });
  }
}
