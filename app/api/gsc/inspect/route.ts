import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";
import { GscError, inspectUrl, resolveProperty, type IndexStatus } from "@/lib/gsc";

// Index status for a handful of pages. Google allows ~2,000 inspections per
// property per day, so each URL's result is kept for a day.
const MAX_URLS = 12;

export async function POST(req: NextRequest) {
  const { client: slug, urls, fresh } = (await req.json()) as { client?: string; urls?: string[]; fresh?: boolean };
  if (!slug || !Array.isArray(urls)) return NextResponse.json({ error: "Missing client or urls" }, { status: 400 });

  const config = await getClient(slug);
  const property = config ? await resolveProperty(config).catch(() => null) : null;
  if (!property) return NextResponse.json({ status: "not_configured", results: {} });

  const db = await getDb();
  const results: Record<string, IndexStatus> = {};

  try {
    for (const url of urls.slice(0, MAX_URLS)) {
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
      const status = await inspectUrl(property, url);
      results[url] = status;
      await db.execute({
        sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
              VALUES (?, 'gsc_inspect', ?, ?, datetime('now'))`,
        args: [slug, url, JSON.stringify(status)],
      });
    }
    return NextResponse.json({ status: "ok", results });
  } catch (err) {
    // Keep whatever finished before the failure.
    if (err instanceof GscError) return NextResponse.json({ status: err.kind, message: err.message, results });
    console.error("URL inspection error:", err);
    return NextResponse.json({ status: "error", message: "Couldn't check index status.", results });
  }
}
