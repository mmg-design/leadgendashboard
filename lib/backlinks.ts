import type { ClientConfig } from "./clients";
import { getDb } from "./db";
import { dfs, dfsDate } from "./dataforseo";

// The backlink report behind the Links tab and the Agents "Links" tasks:
// who links to the client, what was gained and lost, which links the
// competitors have that the client doesn't, and pages whose links now land
// on a 404. Every number comes from DataForSEO's Backlinks API (competitors
// from DataForSEO Labs). Lookups are paid per call, so a report is cached for
// 14 days and only refreshed early on request.

const CACHE_DAYS = 14;
const COMPETITORS = 3;
const SOURCE = "dataforseo";

export interface LinkingDomain {
  domain: string;
  authority: number; // DataForSEO domain rank, 0-100
  backlinks: number;
  dofollow: number;
  firstSeen: string | null;
}

export interface BacklinkReport {
  domain: string;
  fetchedAt: string;
  source?: "dataforseo" | "seranking"; // reports cached before the switch have none (SE Ranking)
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
  history: { date: string; backlinks: number }[]; // monthly, last 12 months (weekly in older SE Ranking reports)
  recent: { domain: string; type: "new" | "lost"; date: string; authority: number; junk: boolean }[]; // referring domains, last 30 days
  junkBurst: { count: number; from: string; to: string; sample: string[] } | null;
  best: LinkingDomain[];
  anchors: { anchor: string; refdomains: number; junk: boolean }[];
  pages: { url: string; path: string; refdomains: number; status: number | null }[];
  competitors: { domain: string; refdomains: number; authority: number }[];
  gap: { domain: string; authority: number; competitors: string[] }[];
  lost: { domain: string; urlFrom: string; urlTo: string; anchor: string; title: string; date: string; reason: string; authority: number }[];
  linking?: string[]; // every site linking to the client, so prospect research skips them
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
const ymd = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

// ── DataForSEO ──────────────────────────────────────────────────────────────

// Authority everywhere is DataForSEO's domain rank on its 0-100 scale, so the
// thresholds below (gap sites at 50+, prospects at 30+) keep their meaning.
const SCALE = { rank_scale: "one_hundred" } as const;

type Items<T> = { items?: T[] | null; total_count?: number };

interface RefdomainItem {
  domain: string;
  rank: number;
  backlinks: number;
  first_seen?: string | null;
  lost_date?: string | null;
  referring_pages?: number;
  referring_pages_nofollow?: number;
  referring_links_attributes?: Record<string, number> | null;
}

interface RefdomainRow { refdomain: string; backlinks: number; dofollow_backlinks: number; domain_inlink_rank: number; first_seen?: string }

// Followed links from one referring domain. DataForSEO counts nofollow links
// per domain; older responses only give pages, so fall back to those.
function dofollowOf(r: RefdomainItem) {
  const nofollow = r.referring_links_attributes?.nofollow;
  if (nofollow != null) return Math.max(0, (r.backlinks || 0) - nofollow);
  return Math.max(0, (r.referring_pages || 0) - (r.referring_pages_nofollow || 0));
}

const toRow = (r: RefdomainItem): RefdomainRow => ({
  refdomain: r.domain,
  backlinks: r.backlinks || 0,
  dofollow_backlinks: dofollowOf(r),
  domain_inlink_rank: Math.round(r.rank || 0),
  first_seen: ymd(r.first_seen) || undefined,
});

const refdomains = (target: string, limit: number) =>
  dfs<Items<RefdomainItem>>("/backlinks/referring_domains/live", { target, limit, order_by: ["rank,desc"], ...SCALE })
    .then((r) => (r?.items || []).map(toRow));

// Domain ranks for up to 1,000 domains in one call; missing domains score 0.
export async function domainAuthorities(domains: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const roots = [...new Set(domains.map(rootOf))];
  for (let i = 0; i < roots.length; i += 1000) {
    const batch = roots.slice(i, i + 1000);
    const res = await dfs<Items<{ target: string; rank: number }>>("/backlinks/bulk_ranks/live", { targets: batch, ...SCALE });
    for (const it of res?.items || []) out.set(rootOf(it.target), Math.round(it.rank || 0));
  }
  return out;
}

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

  const competitorDomains = await dfs<Items<{ domain: string }>>("/dataforseo_labs/google/competitors_domain/live", {
    target, location_code: 2840, language_code: "en", exclude_top_domains: true, limit: 10,
  })
    .then((r) => (r?.items || []).map((it) => rootOf(it.domain)).filter((d) => d !== target && !isJunkDomain(d)).slice(0, COMPETITORS))
    .catch(() => [] as string[]);

  // Everything is requested together and awaited together, so one failure
  // can't leave the others running unobserved.
  const [summary, mine, historyRes, recentRd, lostLinks, anchorsRes, pagesRes, rivalRanks, rivalCounts, rivalRows] = await Promise.all([
    dfs<{
      backlinks: number; referring_domains: number; referring_domains_nofollow: number; rank: number;
    }>("/backlinks/summary/live", { target, include_subdomains: true, ...SCALE }),
    refdomains(target, 1000),
    dfs<Items<{ date: string; backlinks: number }>>("/backlinks/history/live", { target, date_from: d365, date_to: today }),
    // Referring domains first seen or lost in the last 30 days. Two lookups:
    // an "or" across first_seen and lost_date returns nothing.
    Promise.all([
      dfs<Items<RefdomainItem>>("/backlinks/referring_domains/live", {
        target, backlinks_status_type: "live", limit: 500, order_by: ["rank,desc"], ...SCALE,
        filters: ["first_seen", ">=", dfsDate(d30)],
      }),
      dfs<Items<RefdomainItem>>("/backlinks/referring_domains/live", {
        target, backlinks_status_type: "lost", limit: 500, order_by: ["rank,desc"], ...SCALE,
        filters: ["lost_date", ">=", dfsDate(d30)],
      }),
    ]).then(([gained, lost]) => [...(gained?.items || []), ...(lost?.items || [])]),
    dfs<Items<{
      domain_from: string; url_from: string; url_to: string; anchor: string | null; page_from_title: string | null;
      last_seen: string | null; domain_from_rank: number; url_to_status_code?: number | null;
    }>>("/backlinks/backlinks/live", {
      target, mode: "as_is", backlinks_status_type: "lost", limit: 300, order_by: ["domain_from_rank,desc"], ...SCALE,
      // Backlinks carry no lost date; a lost link's last_seen is when it went.
      filters: ["last_seen", ">=", dfsDate(d180)],
    }),
    dfs<Items<{ anchor: string; referring_domains: number }>>("/backlinks/anchors/live", { target, limit: 10, order_by: ["referring_domains,desc"] }),
    dfs<Items<{ url: string; referring_domains: number }>>("/backlinks/domain_pages_summary/live", { target, limit: 30, order_by: ["referring_domains,desc"] }),
    // Competitors are best-effort: a failed lookup leaves that rival out.
    competitorDomains.length ? domainAuthorities(competitorDomains).catch(() => new Map<string, number>()) : new Map<string, number>(),
    competitorDomains.length
      ? dfs<Items<{ target: string; referring_domains: number }>>("/backlinks/bulk_referring_domains/live", { targets: competitorDomains })
        .then((r) => new Map((r?.items || []).map((it) => [rootOf(it.target), it.referring_domains] as const)))
        .catch(() => new Map<string, number>())
      : new Map<string, number>(),
    Promise.all(competitorDomains.map((c) => refdomains(c, 300).catch(() => [] as RefdomainRow[]))),
  ]);
  if (!summary || (!summary.referring_domains && !mine.length)) throw new Error("DataForSEO has no backlink data for this domain yet");

  const competitors: BacklinkReport["competitors"] = [];
  const theirs = new Map<string, { authority: number; from: Set<string> }>();
  competitorDomains.forEach((c, i) => {
    const rows = rivalRows[i];
    const count = rivalCounts.get(c);
    if (count == null && !rows.length) return;
    competitors.push({ domain: c, refdomains: count ?? rows.length, authority: rivalRanks.get(c) ?? 0 });
    for (const r of rows) {
      const root = rootOf(r.refdomain);
      if (isJunkDomain(root) || root === target) continue;
      const entry = theirs.get(root) || { authority: r.domain_inlink_rank, from: new Set<string>() };
      entry.from.add(c);
      theirs.set(root, entry);
    }
  });

  const mineRoots = new Set(mine.map((r) => rootOf(r.refdomain)));
  const real = mine.filter((r) => !isJunkDomain(rootOf(r.refdomain)));
  // A link two rivals share says the site links in this niche; a single
  // rival's link only counts when the site carries real weight.
  const gap = [...theirs.entries()]
    .filter(([root, e]) => !mineRoots.has(root) && (e.from.size >= 2 || e.authority >= 50))
    .map(([domain, e]) => ({ domain, authority: e.authority, competitors: [...e.from] }))
    .sort((a, b) => b.competitors.length - a.competitors.length || b.authority - a.authority)
    .slice(0, 25);

  const recent: BacklinkReport["recent"] = recentRd.map((r) => {
    const lostOn = ymd(r.lost_date);
    const isLost = !!lostOn && lostOn >= d30;
    const domain = rootOf(r.domain);
    return { domain, type: isLost ? "lost" : "new", date: (isLost ? lostOn : ymd(r.first_seen)) || today, authority: Math.round(r.rank || 0), junk: isJunkDomain(domain) };
  });
  const junkNew = recent.filter((r) => r.type === "new" && r.junk);
  const junkBurst = junkNew.length >= 20
    ? { count: junkNew.length, from: junkNew.map((r) => r.date).sort()[0], to: junkNew.map((r) => r.date).sort().at(-1)!, sample: junkNew.slice(0, 4).map((r) => r.domain) }
    : null;

  // Lost links worth asking back for: real sites, not link farms, one per domain.
  const lostByDomain = new Map<string, BacklinkReport["lost"][number]>();
  for (const l of lostLinks?.items || []) {
    const domain = hostOf(l.url_from) || rootOf(l.domain_from);
    if (isJunkDomain(domain) || JUNK_URL.test(l.url_from) || isJunkAnchor(l.anchor || "")) continue;
    // The site still links from another page, so nothing was really lost.
    if (real.some((r) => rootOf(r.refdomain) === domain && r.dofollow_backlinks > 0)) continue;
    if (!lostByDomain.has(domain)) {
      const code = l.url_to_status_code;
      lostByDomain.set(domain, {
        domain, urlFrom: l.url_from, urlTo: l.url_to, anchor: l.anchor || "", title: l.page_from_title || "",
        date: ymd(l.last_seen) || today,
        reason: code && code >= 400 ? `the linked page returned ${code}` : "",
        authority: Math.round(l.domain_from_rank || 0),
      });
    }
  }

  // http, https and www versions of one page are listed separately; keep the
  // biggest per path (the same sites mostly link to several versions).
  const byPath = new Map<string, { url: string; refdomains: number }>();
  for (const p of pagesRes?.items || []) {
    if (!p.url) continue;
    const prev = byPath.get(pathOf(p.url));
    if (!prev || p.referring_domains > prev.refdomains) byPath.set(pathOf(p.url), { url: p.url, refdomains: p.referring_domains });
  }
  const topPages = [...byPath.values()].sort((a, b) => b.refdomains - a.refdomains).slice(0, 10);
  const statuses = await Promise.all(topPages.map((p) => statusOf(p.url)));

  // DataForSEO keeps one point per month.
  const history = (historyRes?.items || [])
    .map((h) => ({ date: ymd(h.date)!, backlinks: h.backlinks || 0 }))
    .filter((h) => h.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const dofollowRefdomains = Math.max(0, (summary.referring_domains || 0) - (summary.referring_domains_nofollow || 0));
  const eduGov = [...mineRoots].filter((d) => /\.(edu|gov)(\.[a-z]{2})?$/.test(d)).length;

  return {
    domain: target,
    fetchedAt: now.toISOString(),
    source: SOURCE,
    totals: {
      backlinks: summary.backlinks || 0,
      refdomains: summary.referring_domains || mine.length,
      dofollowRefdomains,
      realFollowed: real.filter((r) => r.dofollow_backlinks > 0).length,
      realRefdomains: Math.max(0, (summary.referring_domains || mine.length) - (mine.length - real.length)),
      junkRefdomains: mine.length - real.length,
      authority: Math.round(summary.rank || 0),
      eduGov,
    },
    history,
    recent,
    junkBurst,
    best: real.slice(0, 15).map((r) => ({ domain: rootOf(r.refdomain), authority: r.domain_inlink_rank, backlinks: r.backlinks, dofollow: r.dofollow_backlinks, firstSeen: r.first_seen || null })),
    anchors: (anchorsRes?.items || []).slice(0, 10).map((a) => ({ anchor: a.anchor, refdomains: a.referring_domains, junk: isJunkAnchor(a.anchor || "") })),
    pages: topPages.map((p, i) => ({ url: p.url, path: pathOf(p.url), refdomains: p.refdomains, status: statuses[i] })),
    competitors,
    gap,
    lost: [...lostByDomain.values()].sort((a, b) => b.authority - a.authority).slice(0, 12),
    linking: [...mineRoots],
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

// A report cached from SE Ranking counts as stale, so each client moves to
// DataForSEO the next time its Links tab opens.
export const reportIsStale = (r: BacklinkReport | null) =>
  !r || r.source !== SOURCE || Date.now() - new Date(r.fetchedAt).getTime() > CACHE_DAYS * 86_400_000;

export async function getBacklinkReport(slug: string, config: ClientConfig, fresh = false): Promise<BacklinkReport> {
  const cached = await cachedBacklinkReport(slug);
  if (cached && !fresh && !reportIsStale(cached)) return cached;
  const report = await buildBacklinkReport(config);
  const db = await getDb();
  // Keep each client's last SE Ranking report as a before/after record. The
  // first copy wins, so later refreshes never overwrite it.
  if (cached && cached.source !== SOURCE) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'backlinks_seranking', 'all', ?, ?)`,
      args: [slug, JSON.stringify({ ...cached, source: "seranking" }), cached.fetchedAt],
    });
  }
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
          VALUES (?, 'backlinks', 'all', ?, datetime('now'))`,
    args: [slug, JSON.stringify(report)],
  });
  return report;
}
