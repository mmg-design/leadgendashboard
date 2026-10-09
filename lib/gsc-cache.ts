import { getDb } from "./db";
import { getPerformance, inspectUrl, type GscPerformance, type IndexStatus } from "./gsc";

// Search Console reads with the dashboard's caching rules, shared by the API
// routes and the Agents task scan so both spend the same daily quota.

const PERFORMANCE_CACHE_HOURS = 6; // Search Console data only updates about once a day
const MAX_INSPECTIONS = 12;

export async function cachedPerformance(
  slug: string,
  property: string,
  domain: string,
  range: string,
  days: number,
  fresh = false
): Promise<GscPerformance & { status: "ok"; property: string }> {
  const db = await getDb();
  if (!fresh) {
    const cached = await db.execute({
      sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'gsc_performance' AND date_range = ?
            AND fetched_at > datetime('now', ?)`,
      args: [slug, range, `-${PERFORMANCE_CACHE_HOURS} hours`],
    });
    if (cached.rows.length > 0) return JSON.parse(cached.rows[0].data as string);
  }
  const perf = await getPerformance(property, domain, days);
  const data = { status: "ok" as const, property, ...perf };
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
          VALUES (?, 'gsc_performance', ?, ?, datetime('now'))`,
    args: [slug, range, JSON.stringify(data)],
  });
  return data;
}

// Index status for up to 12 URLs. Google allows ~2,000 inspections per
// property per day, so each URL's result is kept for a day. Results that
// finished before an error are kept in `into`.
export async function cachedInspections(
  slug: string,
  property: string,
  urls: string[],
  fresh = false,
  into: Record<string, IndexStatus> = {}
): Promise<Record<string, IndexStatus>> {
  const db = await getDb();
  const toInspect: string[] = [];
  for (const url of urls.slice(0, MAX_INSPECTIONS)) {
    if (!fresh) {
      const cached = await db.execute({
        sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'gsc_inspect' AND date_range = ?
              AND fetched_at > datetime('now', '-24 hours')`,
        args: [slug, url],
      });
      if (cached.rows.length > 0) {
        into[url] = JSON.parse(cached.rows[0].data as string);
        continue;
      }
    }
    toInspect.push(url);
  }

  // In parallel: each inspection takes ~8s at Google, one-by-one took 30s+ for
  // a first visit in production, and Google allows 600 inspections a minute.
  const statuses = await Promise.all(toInspect.map((url) => inspectUrl(property, url)));
  for (const [i, status] of statuses.entries()) {
    into[toInspect[i]] = status;
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'gsc_inspect', ?, ?, datetime('now'))`,
      args: [slug, toInspect[i], JSON.stringify(status)],
    });
  }
  return into;
}
