import type { ClientConfig } from "./clients";
import { getDb } from "./db";

// The backlink report behind the Links tab and the Agents "Links" tasks:
// who links to the client, what was gained and lost, which links the
// competitors have that the client doesn't, and pages whose links now land
// on a 404. Every number comes from SE Ranking's Backlinks API, using the
// same key as rank tracking. Lookups spend SE Ranking credits, so a report is
// cached for a week and only refreshed early on request.

const BASE = "https://api.seranking.com/v1";
const CACHE_DAYS = 7;
const COMPETITORS = 3;

export interface LinkingDomain {
  domain: string;
  authority: number; // SE Ranking Domain InLink Rank, 0-100
  backlinks: number;
  dofollow: number;
  firstSeen: string | null;
}

export interface BacklinkReport {
  domain: string;
  fetchedAt: string;
  totals: {
    backlinks: number;
    refdomains: number;
    dofollowRefdomains: number;
    realFollowed: number; // real linking sites with at least one followed link
    realRefdomains: number; // after removing likely junk
    junkRefdomains: number;
    authority: number;
    eduGov: number;
  };
  history: { date: string; backlinks: number }[]; // weekly, last 12 months
  recent: { domain: string; type: "new" | "lost"; date: string; authority: number; junk: boolean }[]; // referring domains, last 30 days
  junkBurst: { count: number; from: string; to: string; sample: string[] } | null;
  best: LinkingDomain[];
  anchors: { anchor: string; refdomains: number; junk: boolean }[];
  pages: { url: string; path: string; refdomains: number; status: number | null }[];
  competitors: { domain: string; refdomains: number; authority: number }[];
  gap: { domain: string; authority: number; competitors: string[] }[];
  lost: { domain: string; urlFrom: string; urlTo: string; anchor: string; title: string; date: string; reason: string; authority: number }[];
}

// ── Junk detection ──────────────────────────────────────────────────────────
// Automated link farms point thousands of throwaway domains at every site.
// Google ignores them, so they're counted separately instead of inflating
// the client's link count. These are plain patterns, so "likely" junk.

const JUNK_NAME = /backlink|seo|linkbuild|link-build|rankboost|websitechecker|website-checker|shortener|shortenurl|freemyip|loseyourip|webredirect|anchorurl|screenshots|whois|siteinfo|^domains?\./i;
const JUNK_TLD = /\.(site|store|shop|online|space|website|xyz|top|click|icu|fun|sbs|cfd|monster|party|homes|fyi|cloud|buzz|rest|bond|lol|cyou|quest|world|wiki|club)$/i;
const JUNK_ANCHOR = /start own seo business|boost search rankings|authority backlinks|premium .* backlinks/i;
const JUNK_URL = /website_checker|\/seo-?check|backlink/i;

export const isJunkDomain = (domain: string) => JUNK_NAME.test(domain) || JUNK_TLD.test(domain);
const isJunkAnchor = (anchor: string) => JUNK_ANCHOR.test(anchor);

const rootOf = (host: string) => host.toLowerCase().replace(/^www\./, "");
const hostOf = (url: string) => { try { return rootOf(new URL(url).hostname); } catch { return rootOf(url); } };
const pathOf = (url: string) => { try { return new URL(url).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const day = (d: Date) => d.toISOString().slice(0, 10);

// ── SE Ranking ──────────────────────────────────────────────────────────────

// SE Ranking allows one Data API request per second per key, shared by every
// report being built, while a single slow lookup can take 20+ seconds. So
// requests start one per second (slow ones overlap) and a rejected one waits
// for a later slot.
const GAP_MS = 1100;
let nextSlot = 0;
function slot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  return new Promise((r) => setTimeout(r, at - now));
}

async function sr<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.SERANKING_API_KEY;
  if (!key) throw new Error("SE Ranking isn't connected");
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt++) {
    await slot();
    const res = await fetch(url, { headers: { Authorization: `Token ${key}` }, cache: "no-store", signal: AbortSignal.timeout(45_000) });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) continue;
    if (!res.ok) throw new Error(`SE Ranking ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return res.json() as Promise<T>;
  }
}

type RefdomainRow = { refdomain: string; backlinks: number; dofollow_backlinks: number; domain_inlink_rank: number; first_seen?: string };
type SummaryRow = {
  backlinks: number; refdomains: number; dofollow_refdomains: number; domain_inlink_rank: number; edu_refdomains: number; gov_refdomains: number;
  top_anchors_by_refdomains?: { anchor: string; refdomains: number }[];
  top_pages_by_refdomains?: { url: string; refdomains: number }[];
};

const refdomains = (target: string, limit: number) =>
  sr<{ refdomains: RefdomainRow[] }>("/backlinks/refdomains", { target, mode: "domain", limit: String(limit), order_by: "domain_inlink_rank" }).then((r) => r.refdomains || []);

// Checks whether pages that earned links still load, so links pointing at a
// removed page can be recovered with a redirect.
async function statusOf(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (compatible; MMG Pulse link check)" } });
    return res.status;
  } catch {
    return null;
  }
}

export async function buildBacklinkReport(config: ClientConfig): Promise<BacklinkReport> {
  const target = rootOf(config.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  const now = new Date();
  const d30 = day(new Date(now.getTime() - 30 * 86_400_000));
  const d180 = day(new Date(now.getTime() - 180 * 86_400_000));
  const d365 = day(new Date(now.getTime() - 364 * 86_400_000));
  const today = day(now);

  const competitorDomains = await sr<{ domain: string }[]>("/domain/competitors", { source: "us", domain: target, type: "organic" })
    .then((rows) => (Array.isArray(rows) ? rows : []).map((r) => rootOf(r.domain)).filter((d) => d !== target).slice(0, COMPETITORS))
    .catch(() => [] as string[]);

  // Everything is requested together and awaited together, so one failure
  // can't leave the others running unobserved.
  const [summaryRes, mine, cumulative, recentRd, lostLinks, rivalData] = await Promise.all([
    sr<{ summary: SummaryRow[] }>("/backlinks/summary", { target, mode: "domain" }),
    refdomains(target, 500),
    sr<{ backlinks_count: { date: string; backlinks: number }[] }>("/backlinks/history/cumulative", { target, mode: "domain", date_from: d365, date_to: today }),
    sr<{ new_lost_refdomains: { new_lost_date: string; new_lost_type: "new" | "lost"; refdomain: string; domain_inlink_rank: number }[] }>(
      "/backlinks/refdomains/history", { target, mode: "domain", date_from: d30, date_to: today, limit: "500" }),
    sr<{ new_lost_backlinks: { new_lost_date: string; url_from: string; url_to: string; anchor: string | null; title: string | null; reason_lost?: string; domain_inlink_rank: number }[] }>(
      "/backlinks/history", { target, mode: "domain", date_from: d180, date_to: today, new_lost_type: "lost", limit: "200" }),
    // Competitors are best-effort: a failed lookup leaves that rival out.
    Promise.all(competitorDomains.map(async (c) => {
      const [metrics, authority, rows] = await Promise.all([
        sr<{ metrics: { refdomains: number }[] }>("/backlinks/metrics", { target: c, mode: "domain" }).then((r) => r.metrics?.[0] ?? null).catch(() => null),
        sr<{ pages: { domain_inlink_rank: number }[] }>("/backlinks/authority", { target: c }).then((r) => r.pages?.[0]?.domain_inlink_rank ?? 0).catch(() => 0),
        refdomains(c, 150).catch(() => [] as RefdomainRow[]),
      ]);
      return { domain: c, metrics, authority, rows };
    })),
  ]);
  const summary = summaryRes.summary?.[0];
  if (!summary) throw new Error("SE Ranking has no backlink data for this domain yet");

  const competitors: BacklinkReport["competitors"] = [];
  const theirs = new Map<string, { authority: number; from: Set<string> }>();
  for (const { domain: c, metrics, authority, rows } of rivalData) {
    if (!metrics && !rows.length) continue;
    competitors.push({ domain: c, refdomains: metrics?.refdomains ?? rows.length, authority });
    for (const r of rows) {
      const root = rootOf(r.refdomain);
      if (isJunkDomain(root) || root === target) continue;
      const entry = theirs.get(root) || { authority: r.domain_inlink_rank, from: new Set<string>() };
      entry.from.add(c);
      theirs.set(root, entry);
    }
  }

  const mineRoots = new Set(mine.map((r) => rootOf(r.refdomain)));
  const real = mine.filter((r) => !isJunkDomain(rootOf(r.refdomain)));
  // A link two rivals share says the site links in this niche; a single
  // rival's link only counts when the site carries real weight.
  const gap = [...theirs.entries()]
    .filter(([root, e]) => !mineRoots.has(root) && (e.from.size >= 2 || e.authority >= 50))
    .map(([domain, e]) => ({ domain, authority: e.authority, competitors: [...e.from] }))
    .sort((a, b) => b.competitors.length - a.competitors.length || b.authority - a.authority)
    .slice(0, 25);

  const recent = (recentRd.new_lost_refdomains || []).map((r) => ({
    domain: rootOf(r.refdomain), type: r.new_lost_type, date: r.new_lost_date, authority: r.domain_inlink_rank, junk: isJunkDomain(rootOf(r.refdomain)),
  }));
  const junkNew = recent.filter((r) => r.type === "new" && r.junk);
  const junkBurst = junkNew.length >= 20
    ? { count: junkNew.length, from: junkNew.map((r) => r.date).sort()[0], to: junkNew.map((r) => r.date).sort().at(-1)!, sample: junkNew.slice(0, 4).map((r) => r.domain) }
    : null;

  // Lost links worth asking back for: real sites, not link farms, one per domain.
  const lostByDomain = new Map<string, BacklinkReport["lost"][number]>();
  for (const l of lostLinks.new_lost_backlinks || []) {
    const domain = hostOf(l.url_from);
    if (isJunkDomain(domain) || JUNK_URL.test(l.url_from) || isJunkAnchor(l.anchor || "")) continue;
    // The site still links from another page, so nothing was really lost.
    if (real.some((r) => rootOf(r.refdomain) === domain && r.dofollow_backlinks > 0)) continue;
    if (!lostByDomain.has(domain)) {
      lostByDomain.set(domain, { domain, urlFrom: l.url_from, urlTo: l.url_to, anchor: l.anchor || "", title: l.title || "", date: l.new_lost_date, reason: l.reason_lost || "", authority: l.domain_inlink_rank });
    }
  }

  // http, https and www versions of one page are listed separately; keep the
  // biggest per path (the same sites mostly link to several versions).
  const byPath = new Map<string, { url: string; refdomains: number }>();
  for (const p of summary.top_pages_by_refdomains || []) {
    const prev = byPath.get(pathOf(p.url));
    if (!prev || p.refdomains > prev.refdomains) byPath.set(pathOf(p.url), p);
  }
  const topPages = [...byPath.values()].slice(0, 10);
  const statuses = await Promise.all(topPages.map((p) => statusOf(p.url)));

  // Weekly points keep the chart readable over a year.
  // SE Ranking lists history newest first.
  const daily = [...(cumulative.backlinks_count || [])].sort((a, b) => a.date.localeCompare(b.date));
  const history = daily.filter((_, i) => (daily.length - 1 - i) % 7 === 0);

  return {
    domain: target,
    fetchedAt: now.toISOString(),
    totals: {
      backlinks: summary.backlinks,
      refdomains: summary.refdomains,
      dofollowRefdomains: summary.dofollow_refdomains,
      realFollowed: real.filter((r) => r.dofollow_backlinks > 0).length,
      realRefdomains: Math.max(0, summary.refdomains - (mine.length - real.length)),
      junkRefdomains: mine.length - real.length,
      authority: summary.domain_inlink_rank,
      eduGov: (summary.edu_refdomains || 0) + (summary.gov_refdomains || 0),
    },
    history,
    recent,
    junkBurst,
    best: real.slice(0, 15).map((r) => ({ domain: rootOf(r.refdomain), authority: r.domain_inlink_rank, backlinks: r.backlinks, dofollow: r.dofollow_backlinks, firstSeen: r.first_seen || null })),
    anchors: (summary.top_anchors_by_refdomains || []).slice(0, 10).map((a) => ({ anchor: a.anchor, refdomains: a.refdomains, junk: isJunkAnchor(a.anchor) })),
    pages: topPages.map((p, i) => ({ url: p.url, path: pathOf(p.url), refdomains: p.refdomains, status: statuses[i] })),
    competitors,
    gap,
    lost: [...lostByDomain.values()].sort((a, b) => b.authority - a.authority).slice(0, 12),
  };
}

// ── Cache ───────────────────────────────────────────────────────────────────

export async function cachedBacklinkReport(slug: string): Promise<BacklinkReport | null> {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'backlinks' AND date_range = 'all'`,
    args: [slug],
  });
  return res.rows[0] ? (JSON.parse(res.rows[0].data as string) as BacklinkReport) : null;
}

export const reportIsStale = (r: BacklinkReport | null) => !r || Date.now() - new Date(r.fetchedAt).getTime() > CACHE_DAYS * 86_400_000;

export async function getBacklinkReport(slug: string, config: ClientConfig, fresh = false): Promise<BacklinkReport> {
  const cached = await cachedBacklinkReport(slug);
  if (cached && !fresh && !reportIsStale(cached)) return cached;
  const report = await buildBacklinkReport(config);
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
          VALUES (?, 'backlinks', 'all', ?, datetime('now'))`,
    args: [slug, JSON.stringify(report)],
  });
  return report;
}
