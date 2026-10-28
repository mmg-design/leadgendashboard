import { getDb } from "./db";
import type { ClientConfig } from "./clients";
import { dailyTotals, resolveProperty, type DayTotals } from "./gsc";
import { getEvent, googleUpdates, listEvents, type SiteEvent } from "./site-events";

// Before/after for one change: the affected pages' Google search numbers for
// the 14 days before vs. the 14 days after, next to the whole site over the
// same days (so "+38% while the site was +4%" reads differently from "+38%
// while everything rose"). Correlation, not proof; overlapping changes are
// listed so they're read together.

const WINDOW = 14;
const MIN_AFTER = 7; // below this, show "measuring" instead of a noisy number
const GSC_LAG_DAYS = 3; // Search Console data settles about 3 days behind
const MAX_PAGES = 10;

export interface Totals { clicksPerDay: number; impressionsPerDay: number; ctr: number; position: number | null }
export interface EventImpact {
  status: "ok" | "measuring" | "no_data" | "not_connected";
  scope: "page" | "site";
  daysAfter: number;
  window: number;
  before?: Totals;
  after?: Totals;
  change?: { clicksPct: number | null; impressionsPct: number | null; ctrPts: number; position: number | null };
  site?: { clicksPct: number | null };
  overlaps: string[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pct = (a: number, b: number) => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null);

function summarize(rows: DayTotals[], from: string, to: string): Totals {
  const inRange = rows.filter((r) => r.date >= from && r.date <= to);
  const days = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1);
  const clicks = inRange.reduce((s, r) => s + r.clicks, 0);
  const impressions = inRange.reduce((s, r) => s + r.impressions, 0);
  const weighted = inRange.reduce((s, r) => s + r.position * r.impressions, 0);
  return {
    clicksPerDay: Math.round((clicks / days) * 10) / 10,
    impressionsPerDay: Math.round((impressions / days) * 10) / 10,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? Math.round((weighted / impressions) * 10) / 10 : null,
  };
}

function pageRegex(pages: string[]) {
  const alts = pages.slice(0, MAX_PAGES).map((p) => (p === "/" ? "" : escapeRe(p.replace(/\/+$/, ""))));
  return `^https?://[^/]+(${alts.join("|")})/?(\\?.*)?$`;
}

async function overlapsFor(slug: string, ev: SiteEvent) {
  const all = [...(await listEvents(slug, 400)), ...(await googleUpdates())];
  const near = (e: SiteEvent) => Math.abs(new Date(e.day).getTime() - new Date(ev.day).getTime()) <= 7 * 86_400_000;
  const touches = (e: SiteEvent) => !ev.pages.length || !e.pages.length || e.pages.some((p) => ev.pages.includes(p));
  return all.filter((e) => e.id !== ev.id && near(e) && touches(e)).map((e) => `${e.day}: ${e.title}`).slice(0, 5);
}

export async function eventImpact(slug: string, config: ClientConfig, id: number | string): Promise<EventImpact | null> {
  const ev = typeof id === "number" ? await getEvent(slug, id) : (await googleUpdates()).find((g) => g.id === id) || null;
  if (!ev) return null;
  const db = await getDb();
  const cacheKey = String(ev.id);
  const cached = await db.execute({
    sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'event_impact' AND date_range = ? AND fetched_at > datetime('now', '-12 hours')`,
    args: [slug, cacheKey],
  });
  if (cached.rows[0]) return JSON.parse(cached.rows[0].data as string);

  const overlaps = await overlapsFor(slug, ev);
  const property = await resolveProperty(config).catch(() => null);
  const scope: EventImpact["scope"] = ev.pages.length && ev.pages.length <= MAX_PAGES ? "page" : "site";
  if (!property) return { status: "not_connected", scope, daysAfter: 0, window: WINDOW, overlaps };

  const lastAvailable = iso(new Date(Date.now() - GSC_LAG_DAYS * 86_400_000));
  const beforeFrom = addDays(ev.day, -WINDOW), beforeTo = addDays(ev.day, -1);
  const afterFrom = addDays(ev.day, 1);
  const afterTo = [addDays(ev.day, WINDOW), lastAvailable].sort()[0];
  const daysAfter = afterTo >= afterFrom ? Math.round((new Date(afterTo).getTime() - new Date(afterFrom).getTime()) / 86_400_000) + 1 : 0;

  let result: EventImpact;
  if (daysAfter < MIN_AFTER) {
    result = { status: "measuring", scope, daysAfter, window: WINDOW, overlaps };
  } else {
    const [site, pages] = await Promise.all([
      dailyTotals(property, beforeFrom, afterTo),
      scope === "page" ? dailyTotals(property, beforeFrom, afterTo, pageRegex(ev.pages)) : Promise.resolve(null),
    ]);
    const rows = pages || site;
    const before = summarize(rows, beforeFrom, beforeTo);
    const after = summarize(rows, afterFrom, afterTo);
    if (before.impressionsPerDay + after.impressionsPerDay === 0) {
      result = { status: "no_data", scope, daysAfter, window: WINDOW, overlaps };
    } else {
      const siteBefore = summarize(site, beforeFrom, beforeTo), siteAfter = summarize(site, afterFrom, afterTo);
      result = {
        status: "ok",
        scope,
        daysAfter,
        window: WINDOW,
        before,
        after,
        change: {
          clicksPct: pct(before.clicksPerDay, after.clicksPerDay),
          impressionsPct: pct(before.impressionsPerDay, after.impressionsPerDay),
          ctrPts: Math.round((after.ctr - before.ctr) * 1000) / 10,
          position: before.position != null && after.position != null ? Math.round((before.position - after.position) * 10) / 10 : null,
        },
        site: { clicksPct: pct(siteBefore.clicksPerDay, siteAfter.clicksPerDay) },
        overlaps,
      };
    }
  }
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at) VALUES (?, 'event_impact', ?, ?, datetime('now'))`,
    args: [slug, cacheKey, JSON.stringify(result)],
  });
  return result;
}
