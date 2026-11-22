// What the Keyword Map canvas shows on each page card: the SEO hotspots read
// from the live page (title, meta description, H1, opening paragraph), whether
// Google has it indexed, and how many sites link to it.
//
// All free: the page itself, Search Console's URL Inspection (about 2,000 a
// day per property, cached a day per URL) and the saved backlink report. A
// missing backlink report is never fetched from here, since DataForSEO charges.

import { getDb } from "./db";
import { fetchPage } from "./page-fetch";
import { GscError, resolveProperty, type IndexStatus } from "./gsc";
import { cachedInspections } from "./gsc-cache";
import { cachedBacklinkReport } from "./backlinks";
import { normalizePath } from "./page-behavior";
import type { ClientConfig } from "./clients";

const SNAPSHOT_CACHE_HOURS = 24;
const INSPECT_CHUNK = 12; // cachedInspections' own per-call limit
export const MAX_PAGES_PER_REQUEST = 60;

export interface PageHotspots {
  ok: boolean;
  status: number;
  title: string;
  metaDescription: string;
  h1: string[];
  intro: string;
  noindex: boolean;
}

export interface PageLinks {
  // Sites linking to the page. null when the saved report can't say: it only
  // lists the top pages, or the list was cut off above this page.
  refdomains: number | null;
  note: string | null;
}

export interface PageDetails {
  hotspots: PageHotspots | null;
  index: IndexStatus | null;
  links: PageLinks;
}

export interface PageDetailsResponse {
  pages: Record<string, PageDetails>; // by URL, as requested
  index: { status: "ok" | "not_configured" | "error"; message?: string };
  links: { status: "ok" | "none"; fetchedAt: string | null };
}

// Only the client's own site, so this can't be used to fetch arbitrary URLs.
export function ownUrl(config: ClientConfig, raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const domain = config.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
    if (host !== domain || !/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

async function cachedHotspots(slug: string, url: string, fresh: boolean): Promise<PageHotspots> {
  const db = await getDb();
  if (!fresh) {
    const row = (await db.execute({
      sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'page_hotspots' AND date_range = ?
            AND fetched_at > datetime('now', ?)`,
      args: [slug, url, `-${SNAPSHOT_CACHE_HOURS} hours`],
    })).rows[0];
    if (row) return JSON.parse(row.data as string);
  }
  const s = await fetchPage(url);
  const hotspots: PageHotspots = { ok: s.ok, status: s.status, title: s.title, metaDescription: s.metaDescription, h1: s.h1, intro: s.intro, noindex: s.robotsNoindex };
  // A page that didn't load is retried next time rather than cached for a day.
  if (s.ok) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'page_hotspots', ?, ?, datetime('now'))`,
      args: [slug, url, JSON.stringify(hotspots)],
    });
  }
  return hotspots;
}

export async function pageDetails(slug: string, config: ClientConfig, urls: string[], fresh = false): Promise<PageDetailsResponse> {
  const list = [...new Set(urls)].slice(0, MAX_PAGES_PER_REQUEST);

  // Index status: Search Console allows 600 inspections a minute, so chunks run in parallel.
  const index: Record<string, IndexStatus> = {};
  let indexState: PageDetailsResponse["index"] = { status: "ok" };
  const property = await resolveProperty(config).catch(() => null);
  const indexJob = (async () => {
    if (!property) { indexState = { status: "not_configured" }; return; }
    const chunks: string[][] = [];
    for (let i = 0; i < list.length; i += INSPECT_CHUNK) chunks.push(list.slice(i, i + INSPECT_CHUNK));
    const results = await Promise.allSettled(chunks.map((c) => cachedInspections(slug, property, c, fresh, index)));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) {
      const err = failed.reason;
      indexState = { status: "error", message: err instanceof GscError ? err.message : "Couldn't check index status for every page." };
      if (!(err instanceof GscError)) console.error("Keyword map index check:", err);
    }
  })();

  const [hotspots, report] = await Promise.all([
    Promise.all(list.map((u) => cachedHotspots(slug, u, fresh).catch(() => null))),
    cachedBacklinkReport(slug).catch(() => null),
    indexJob,
  ]);

  // Linking sites per path. Older reports only carry the top 10 pages.
  const linkCounts = new Map<string, number>();
  for (const p of report?.pageLinks || report?.pages || []) linkCounts.set(normalizePath(p.path), p.refdomains);
  const complete = !!report?.pageLinks && !report.pageLinksCapped;
  const lowest = report?.pageLinks?.length ? report.pageLinks[report.pageLinks.length - 1].refdomains : null;

  const pages: Record<string, PageDetails> = {};
  for (const [i, url] of list.entries()) {
    const path = normalizePath(new URL(url).pathname);
    const count = linkCounts.get(path);
    let links: PageLinks;
    if (!report) links = { refdomains: null, note: "No backlink report yet. It comes from the Links tab." };
    else if (count != null) links = { refdomains: count, note: null };
    else if (complete) links = { refdomains: 0, note: null };
    else if (report.pageLinks) links = { refdomains: null, note: `Fewer than ${lowest ?? "a few"} linking sites` };
    else links = { refdomains: null, note: "Not in the report's top 10 pages. Counts for every page arrive with the next backlink refresh." };
    pages[url] = { hotspots: hotspots[i], index: index[url] || null, links };
  }
  return {
    pages,
    index: indexState,
    links: { status: report ? "ok" : "none", fetchedAt: report?.fetchedAt ?? null },
  };
}
