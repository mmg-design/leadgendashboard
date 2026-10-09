import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";
import { getPerformance, GscError, resolveProperty } from "@/lib/gsc";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const CACHE_HOURS = 6; // Search Console data only updates about once a day

// Search queries, clicks and impressions per page for the selected window.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const range = req.nextUrl.searchParams.get("range") || "7d";
  const fresh = req.nextUrl.searchParams.has("_t");
  if (!slug) return NextResponse.json({ error: "Missing client param" }, { status: 400 });

  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  let property: string | null;
  try {
    property = await resolveProperty(config);
  } catch (err) {
    if (err instanceof GscError) return NextResponse.json({ status: err.kind, message: err.message });
    throw err;
  }
  if (!property) {
    return NextResponse.json({ status: "not_configured", message: "Share this site's Search Console property with the dashboard's service account (in Search Console: Settings, then Users and permissions), or enter the property in Settings." });
  }

  const db = await getDb();
  if (!fresh) {
    const cached = await db.execute({
      sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'gsc_performance' AND date_range = ?
            AND fetched_at > datetime('now', ?)`,
      args: [slug, range, `-${CACHE_HOURS} hours`],
    });
    if (cached.rows.length > 0) return NextResponse.json(JSON.parse(cached.rows[0].data as string));
  }

  try {
    const perf = await getPerformance(property, config.domain, RANGE_DAYS[range] || 7);
    const data = { status: "ok", property, ...perf };
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'gsc_performance', ?, ?, datetime('now'))`,
      args: [slug, range, JSON.stringify(data)],
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof GscError) return NextResponse.json({ status: err.kind, message: err.message, property });
    console.error("Search Console error:", err);
    return NextResponse.json({ status: "error", message: "Couldn't load Search Console data.", property });
  }
}
