// The Keyword Map tab: each client's approved core keywords laid out on the
// site's page tree, colored by how well they rank, with the problems worth
// acting on. Team-only.
//
// Everything here is a free read: the saved core set, SE Ranking's project API
// (hourly cache), Search Console (the 30-day cache the Agents scan shares) and
// the sitemap (cached a day). No DataForSEO calls, no SE Ranking units.

import type { ClientConfig } from "./clients";
import { getDb } from "./db";
import { getSeRankingData } from "./seranking";
import { resolveProperty } from "./gsc";
import { cachedPerformance } from "./gsc-cache";
import { sitemapUrls } from "./page-fetch";
import { normalizePath } from "./page-behavior";
import { brandTerms, classifyKeyword, type RankedKeyword } from "./keyword-insights";

export type Priority = "P1" | "P2" | "P3";
export type RankBand = "top3" | "top10" | "top20" | "top50" | "low" | "none";
export type FlagType = "wrong_page" | "other_site" | "competing" | "missing_page" | "slipping" | "off_plan";

export interface MapTerm {
  keyword: string;
  priority: Priority;
  primary: boolean;
  tracked: boolean; // found in SE Ranking
  position: number | null; // null = not in the top 100 (or not tracked)
  delta: number | null; // positions gained over 7 days
  volume: number | null;
  band: RankBand;
  rankingPath: string | null; // the client page SE Ranking sees ranking
  rankingOtherSite: boolean; // a different website ranks for it
  flags: FlagType[];
}

export interface AlsoRanks { query: string; impressions: number; clicks: number; position: number }

export interface MapPage {
  path: string; // "/services/x", or the planned page's label
  label: string;
  url: string | null;
  inSitemap: boolean;
  planned: boolean; // a "Needs page" or "(confirm)" page from the core set
  plannedNote: string | null;
  terms: MapTerm[];
  alsoRanks: AlsoRanks[];
  impressions: number;
  clicks: number;
}

export interface MapNode {
  path: string;
  label: string;
  page: MapPage | null;
  children: MapNode[];
  hiddenCount: number; // pages under here with no target terms or search data
}

export interface MapFlag {
  type: FlagType;
  priority: Priority | null;
  title: string;
  detail: string;
  page: string;
  keyword: string | null;
}

export interface KeywordMap {
  slug: string;
  domain: string;
  origin: string;
  approvedAt: string | null;
  generatedAt: string;
  sources: { seRanking: boolean; searchConsole: boolean; sitemapPages: number };
  summary: { total: number; top3: number; top10: number; notRanking: number; p1Total: number; p1Top10: number; flags: number };
  tree: MapNode;
  flags: MapFlag[];
}

interface CoreSet { approvedAt?: string; terms: { keyword: string; page: string; priority: Priority; primary: boolean }[] }

const SITEMAP_CACHE_HOURS = 24;
const ALSO_RANKS_PER_PAGE = 3;
const ALSO_RANKS_MIN_IMPRESSIONS = 10;
const OFF_PLAN_MIN_IMPRESSIONS = 50;
const OFF_PLAN_MAX_FLAGS = 5;
const COMPETING_MIN_IMPRESSIONS = 5;
const SLIP_POSITIONS = 3;
// Pages with no target terms only show when a query brings real impressions.
const SHOW_PAGE_MIN_IMPRESSIONS = 50;

// Search-operator strings and very long queries are research tools or AI
// agents probing Google, not people searching.
const isNoiseQuery = (q: string) => q.length > 90 || /\b(site|inurl|intitle):|"|\s-\w/.test(q);

export function bandFor(position: number | null): RankBand {
  if (!position) return "none";
  if (position <= 3) return "top3";
  if (position <= 10) return "top10";
  if (position <= 20) return "top20";
  if (position <= 50) return "top50";
  return "low";
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const PRIORITY_RANK: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };

export function labelFor(path: string) {
  if (path === "/") return "Home";
  const seg = path.split("/").filter(Boolean).pop() || path;
  const words = seg.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function getCoreSet(slug: string): Promise<CoreSet | null> {
  const db = await getDb();
  const row = (await db.execute({
    sql: "SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'core_keywords' AND date_range = 'current'",
    args: [slug],
  })).rows[0];
  return row ? (JSON.parse(row.data as string) as CoreSet) : null;
}

async function cachedSitemapPaths(slug: string, origin: string, fresh: boolean): Promise<string[]> {
  const db = await getDb();
  if (!fresh) {
    const row = (await db.execute({
      sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'sitemap_paths' AND date_range = 'current'
            AND fetched_at > datetime('now', ?)`,
      args: [slug, `-${SITEMAP_CACHE_HOURS} hours`],
    })).rows[0];
    if (row) return JSON.parse(row.data as string);
  }
  // Paths only: a staging site's sitemap may already name the launch domain.
  const urls = await sitemapUrls(origin, 500).catch(() => [] as string[]);
  const paths = [...new Set(urls.map((u) => normalizePath(u)))];
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at) VALUES (?, 'sitemap_paths', 'current', ?, datetime('now'))`,
    args: [slug, JSON.stringify(paths)],
  });
  return paths;
}

export async function buildKeywordMap(slug: string, config: ClientConfig, fresh = false): Promise<KeywordMap | null> {
  const core = await getCoreSet(slug);
  if (!core?.terms?.length) return null;

  const sr = config.integrations.seRanking;
  const apiKey = process.env.SERANKING_API_KEY;
  const property = await resolveProperty(config).catch(() => null);

  const [srRes, gscRes] = await Promise.allSettled([
    sr?.enabled && sr.projectId && apiKey ? getSeRankingData(config, apiKey, fresh) : Promise.reject(new Error("SE Ranking isn't connected")),
    property ? cachedPerformance(slug, property, config.domain, "30d", 30, fresh) : Promise.reject(new Error("Search Console isn't connected")),
  ]);
  const ranked = srRes.status === "fulfilled" ? srRes.value.allKeywords : null;
  const gsc = gscRes.status === "fulfilled" ? gscRes.value : null;

  const origin = gsc?.origin || `https://${config.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const sitemapPaths = await cachedSitemapPaths(slug, origin, fresh);
  const inSitemap = new Set(sitemapPaths);

  const byKeyword = new Map<string, RankedKeyword>();
  for (const k of ranked || []) byKeyword.set(norm(k.keyword), k);
  const brands = brandTerms(config.name, config.domain);
  // classifyKeyword misses short brands like "mmg" or "2sp", so also match the
  // first word of the client's name and the domain's main label.
  const domainLabel = config.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0].toLowerCase();
  const nameWord = config.name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
  const brandWords = [...new Set([domainLabel, nameWord].filter((w) => w.length >= 2))];
  const isBrand = (q: string) => {
    const n = norm(q);
    return classifyKeyword(q, brands).branded || brandWords.some((w) => n === w || n.split(/[\s-]+/).includes(w) || n.replace(/\s+/g, "").includes(domainLabel));
  };
  const coreNames = new Set(core.terms.map((t) => norm(t.keyword)));

  // Search Console: each page's queries, and every page a query shows up on.
  const gscPages = new Map<string, { impressions: number; clicks: number; queries: AlsoRanks[] }>();
  const pagesForQuery = new Map<string, { path: string; impressions: number }[]>();
  for (const p of gsc?.pages || []) {
    const path = normalizePath(p.path);
    gscPages.set(path, { impressions: p.impressions, clicks: p.clicks, queries: p.queries.map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.position })) });
    for (const q of p.queries) {
      const key = norm(q.query);
      const list = pagesForQuery.get(key) || [];
      list.push({ path, impressions: q.impressions });
      pagesForQuery.set(key, list);
    }
  }

  const flags: MapFlag[] = [];
  const pages = new Map<string, MapPage>();
  const pageFor = (pageKey: string): MapPage => {
    let page = pages.get(pageKey);
    if (!page) {
      const isPath = pageKey.startsWith("/");
      const path = isPath ? normalizePath(pageKey) : pageKey;
      const g = isPath ? gscPages.get(path) : undefined;
      page = {
        path,
        label: isPath ? labelFor(path) : pageKey.replace(/^Needs page:\s*/i, "").replace(/\s*\(confirm\)\s*$/i, ""),
        url: isPath ? origin + (path === "/" ? "/" : path) : null,
        inSitemap: isPath && inSitemap.has(path),
        planned: !isPath,
        plannedNote: isPath ? null : /needs page/i.test(pageKey) ? "Page to create" : "Page path to confirm",
        terms: [],
        alsoRanks: [],
        impressions: g?.impressions ?? 0,
        clicks: g?.clicks ?? 0,
      };
      pages.set(isPath ? path : pageKey, page);
    }
    return page;
  };

  // Target terms, with their rank and per-term problems.
  for (const t of core.terms) {
    const page = pageFor(t.page);
    const k = byKeyword.get(norm(t.keyword));
    const position = k && k.position > 0 ? k.position : null;
    const rankingPath = k?.landingPath ? normalizePath(k.landingPath) : null;
    const rankingOtherSite = !!(position && !k?.landingPath && k?.landingUrl);
    const term: MapTerm = {
      keyword: t.keyword,
      priority: t.priority,
      primary: t.primary,
      tracked: !!k,
      position,
      delta: k?.delta ?? null,
      volume: k?.volume ?? null,
      band: bandFor(position),
      rankingPath,
      rankingOtherSite,
      flags: [],
    };

    if (!page.planned && position && rankingPath && rankingPath !== page.path) {
      term.flags.push("wrong_page");
      flags.push({ type: "wrong_page", priority: t.priority, keyword: t.keyword, page: page.path, title: `Wrong page ranks for "${t.keyword}"`, detail: `${rankingPath} ranks #${position}, but the target is ${page.path}.` });
    }
    if (rankingOtherSite) {
      term.flags.push("other_site");
      flags.push({ type: "other_site", priority: t.priority, keyword: t.keyword, page: page.path, title: `Another website ranks for "${t.keyword}"`, detail: `SE Ranking sees ${k?.landingUrl} at #${position}, not ${config.domain}.` });
    }
    // Brand searches land on many pages by nature, so they don't count as competing.
    const branded = isBrand(t.keyword);
    const competing = branded ? [] : (pagesForQuery.get(norm(t.keyword)) || []).filter((x) => x.impressions >= COMPETING_MIN_IMPRESSIONS);
    if (competing.length >= 2) {
      term.flags.push("competing");
      const list = competing.sort((a, b) => b.impressions - a.impressions).slice(0, 3).map((x) => `${x.path} (${x.impressions})`).join(", ");
      flags.push({ type: "competing", priority: t.priority, keyword: t.keyword, page: page.path, title: `${competing.length} pages compete for "${t.keyword}"`, detail: `Search Console impressions split across ${list}.` });
    }
    if (t.priority === "P1" && term.delta != null && term.delta <= -SLIP_POSITIONS) {
      term.flags.push("slipping");
      flags.push({ type: "slipping", priority: t.priority, keyword: t.keyword, page: page.path, title: `"${t.keyword}" slipped ${-term.delta} positions`, detail: `Now #${position ?? "not ranking"}, down from #${(position ?? 100) - term.delta} a week ago.` });
    }
    page.terms.push(term);
  }

  // Planned pages: one flag each.
  for (const page of pages.values()) {
    if (!page.planned) continue;
    const best = page.terms.reduce<Priority>((b, t) => (PRIORITY_RANK[t.priority] < PRIORITY_RANK[b] ? t.priority : b), "P3");
    for (const t of page.terms) t.flags.push("missing_page");
    flags.push({
      type: "missing_page", priority: best, keyword: null, page: page.path,
      title: page.plannedNote === "Page to create" ? `Create a page: ${page.label}` : `Confirm the page for: ${page.label}`,
      detail: `${page.terms.length} target ${page.terms.length === 1 ? "term waits" : "terms wait"} on it: ${page.terms.map((t) => t.keyword).join(", ")}.`,
    });
  }

  // "Also ranks for" on each page, and the biggest off-plan queries.
  const offPlan: { query: string; path: string; impressions: number; position: number }[] = [];
  for (const [path, g] of gscPages) {
    const extra = g.queries
      .filter((q) => !coreNames.has(norm(q.query)) && !isNoiseQuery(q.query) && !isBrand(q.query) && q.impressions >= ALSO_RANKS_MIN_IMPRESSIONS)
      .sort((a, b) => b.impressions - a.impressions);
    if (!extra.length) continue;
    const page = pages.get(path) || (inSitemap.has(path) ? pageFor(path) : null);
    if (page) page.alsoRanks = extra.slice(0, ALSO_RANKS_PER_PAGE);
    for (const q of extra) if (q.impressions >= OFF_PLAN_MIN_IMPRESSIONS) offPlan.push({ query: q.query, path, impressions: q.impressions, position: q.position });
  }
  const seenOff = new Set<string>();
  for (const q of offPlan.sort((a, b) => b.impressions - a.impressions)) {
    if (seenOff.has(norm(q.query))) continue;
    seenOff.add(norm(q.query));
    flags.push({ type: "off_plan", priority: null, keyword: q.query, page: q.path, title: `Ranking off plan: "${q.query}"`, detail: `${q.impressions} impressions in 30 days at about #${Math.round(q.position)} on ${q.path}. Add it to the core set, or keep it in mind when editing the page.` });
    if (seenOff.size >= OFF_PLAN_MAX_FLAGS) break;
  }

  // Target terms within a page: primary first, then priority, then rank.
  for (const page of pages.values()) {
    page.terms.sort((a, b) => Number(b.primary) - Number(a.primary) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.position ?? 999) - (b.position ?? 999));
  }

  const tree = buildTree([...pages.values()].filter((p) => !p.planned), sitemapPaths, [...pages.values()].filter((p) => p.planned), origin, inSitemap);

  const terms = [...pages.values()].flatMap((p) => p.terms);
  const severity: Record<FlagType, number> = { slipping: 0, wrong_page: 1, other_site: 2, competing: 3, missing_page: 4, off_plan: 5 };
  flags.sort((a, b) => (a.priority ? PRIORITY_RANK[a.priority] : 3) - (b.priority ? PRIORITY_RANK[b.priority] : 3) || severity[a.type] - severity[b.type]);

  return {
    slug,
    domain: config.domain,
    origin,
    approvedAt: core.approvedAt ?? null,
    generatedAt: new Date().toISOString(),
    sources: { seRanking: !!ranked, searchConsole: !!gsc, sitemapPages: sitemapPaths.length },
    summary: {
      total: terms.length,
      top3: terms.filter((t) => t.band === "top3").length,
      top10: terms.filter((t) => t.band === "top3" || t.band === "top10").length,
      notRanking: terms.filter((t) => t.band === "none").length,
      p1Total: terms.filter((t) => t.priority === "P1").length,
      p1Top10: terms.filter((t) => t.priority === "P1" && (t.band === "top3" || t.band === "top10")).length,
      flags: flags.length,
    },
    tree,
    flags,
  };
}

// The page tree: every sitemap page plus every target page, nested by URL
// path. Pages with no target terms and no Search Console data are counted on
// their parent instead of shown, so the tree stays readable on big sites.
function buildTree(targetPages: MapPage[], sitemapPaths: string[], planned: MapPage[], origin: string, inSitemap: Set<string>): MapNode {
  const pageByPath = new Map(targetPages.map((p) => [p.path, p]));
  const root: MapNode = { path: "/", label: "Home", page: pageByPath.get("/") || null, children: [], hiddenCount: 0 };
  const nodes = new Map<string, MapNode>([["/", root]]);

  const ensure = (path: string): MapNode => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const parentPath = path.split("/").slice(0, -1).join("/") || "/";
    const parent = ensure(parentPath);
    const node: MapNode = { path, label: labelFor(path), page: pageByPath.get(path) || null, children: [], hiddenCount: 0 };
    nodes.set(path, node);
    parent.children.push(node);
    return node;
  };

  for (const path of new Set([...sitemapPaths, ...pageByPath.keys()])) if (path !== "/") ensure(path);

  // Pages that only exist in the sitemap still get a light page record so the
  // tree can show their URL when they have children worth showing.
  for (const node of nodes.values()) {
    if (!node.page && inSitemap.has(node.path)) {
      node.page = { path: node.path, label: node.label, url: origin + node.path, inSitemap: true, planned: false, plannedNote: null, terms: [], alsoRanks: [], impressions: 0, clicks: 0 };
    }
  }

  // The most important target term anywhere in a branch: P1 = 0 … none = 3.
  const bestRank = (x: MapNode): number => Math.min(3, ...(x.page?.terms || []).map((t) => PRIORITY_RANK[t.priority]), ...x.children.map(bestRank));
  const interesting = (n: MapNode) => !!n.page && (n.page.terms.length > 0 || (n.page.alsoRanks[0]?.impressions ?? 0) >= SHOW_PAGE_MIN_IMPRESSIONS);
  const prune = (n: MapNode): boolean => {
    n.children = n.children.filter((c) => {
      const keep = prune(c);
      if (!keep) n.hiddenCount += 1 + c.hiddenCount;
      return keep;
    });
    n.children.sort((a, b) => bestRank(a) - bestRank(b) || Number(!!b.page?.terms.length) - Number(!!a.page?.terms.length) || a.label.localeCompare(b.label));
    return interesting(n) || n.children.length > 0;
  };
  prune(root);

  for (const p of planned) root.children.push({ path: p.path, label: p.label, page: p, children: [], hiddenCount: 0 });
  return root;
}
