// Google Search Console: real search queries per page, index status, sitemaps.
//
// Uses the same service account as GA4. Each client's property must add that
// account as a user (Full permission to resubmit sitemaps), and the Google
// Cloud project needs the Search Console API enabled.
//
// Google has no API to request indexing for ordinary pages (the Indexing API
// is limited to job postings and livestreams), so "fixing" indexing here means
// diagnosing why, resubmitting the sitemap, and linking to Search Console's own
// "Request indexing" button for the last step.

import fs from "fs";
import path from "path";
import { GoogleAuth } from "google-auth-library";
import { normalizePath } from "./page-behavior";

const READ_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";

export type GscErrorKind = "api_disabled" | "no_access" | "not_found" | "error";

export class GscError extends Error {
  constructor(public kind: GscErrorKind, message: string, public status?: number) {
    super(message);
  }
}

function loadCredentials(): Record<string, string> | null {
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    return JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString());
  }
  const credPath = path.join(process.cwd(), "web-lead-gen-mvp-97217b4d6543.json");
  if (fs.existsSync(credPath)) return JSON.parse(fs.readFileSync(credPath, "utf-8"));
  return null;
}

const authByScope = new Map<string, GoogleAuth>();

function authFor(scope: string) {
  let auth = authByScope.get(scope);
  if (!auth) {
    const credentials = loadCredentials();
    if (!credentials) throw new GscError("error", "No Google credentials configured.");
    auth = new GoogleAuth({ credentials, scopes: [scope] });
    authByScope.set(scope, auth);
  }
  return auth;
}

async function gscRequest<T>(url: string, opts: { method?: "GET" | "POST" | "PUT"; data?: unknown; write?: boolean } = {}): Promise<T> {
  const client = await authFor(opts.write ? WRITE_SCOPE : READ_SCOPE).getClient();
  try {
    const res = await client.request<T>({ url, method: opts.method || "GET", data: opts.data });
    return res.data;
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
    const status = e.response?.status;
    const message = e.response?.data?.error?.message || e.message || "Search Console request failed";
    if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
      throw new GscError("api_disabled", "The Search Console API isn't enabled in the dashboard's Google Cloud project yet.", status);
    }
    if (status === 403) {
      throw new GscError("no_access", "The dashboard's service account hasn't been added to this Search Console property.", status);
    }
    if (status === 404) throw new GscError("not_found", "Search Console property not found. Check the property name in Settings.", status);
    throw new GscError("error", message, status);
  }
}

const enc = encodeURIComponent;
const WM = "https://www.googleapis.com/webmasters/v3";

// ── Which property belongs to a client ────────────────────────────────────

let sitesCache: { at: number; sites: string[] } | null = null;

async function accessibleProperties(): Promise<string[]> {
  if (sitesCache && Date.now() - sitesCache.at < 10 * 60_000) return sitesCache.sites;
  const data = await gscRequest<{ siteEntry?: { siteUrl: string }[] }>(`${WM}/sites`);
  const sites = (data.siteEntry || []).map((s) => s.siteUrl);
  sitesCache = { at: Date.now(), sites };
  return sites;
}

// The property set in Settings wins. Otherwise use whichever property shared
// with the service account matches the client's domain, so connecting a client
// is just adding the service account in Search Console.
export async function resolveProperty(config: { domain: string; integrations: { searchConsole?: { enabled: boolean; property: string } } }): Promise<string | null> {
  const configured = config.integrations.searchConsole;
  if (configured?.enabled && configured.property) return configured.property;
  const site = bareDomain(config.domain);
  if (!site) return null;
  const sites = await accessibleProperties();
  return (
    sites.find((s) => s === `sc-domain:${site}`) ||
    sites.find((s) => s.startsWith("http") && hostOf(s) === site) ||
    null
  );
}

// ── Search performance ──────────────────────────────────────────────────────

export interface GscQuery {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface GscPage {
  path: string;
  url: string; // the exact URL Google reports (most impressions), used for index checks
  clicks: number;
  impressions: number;
  ctr: number; // 0-1
  position: number;
  queries: GscQuery[];
}

interface SaRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function hostOf(url: string) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function bareDomain(domain: string) {
  return domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export interface GscPerformance {
  pages: GscPage[];
  // The scheme + host Google actually reports for this site (www or not), used
  // to build exact URLs for inspection.
  origin: string | null;
  startDate: string;
  endDate: string;
}

export async function getPerformance(property: string, domain: string, days: number): Promise<GscPerformance> {
  // Search Console data runs about two days behind; end the window there so the
  // last days aren't half-empty.
  const end = new Date(Date.now() - 2 * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const body = { startDate: fmt(start), endDate: fmt(end), type: "web" };
  const url = `${WM}/sites/${enc(property)}/searchAnalytics/query`;

  const [byPage, byPageQuery] = await Promise.all([
    gscRequest<{ rows?: SaRow[] }>(url, { method: "POST", data: { ...body, dimensions: ["page"], rowLimit: 500 } }),
    gscRequest<{ rows?: SaRow[] }>(url, { method: "POST", data: { ...body, dimensions: ["page", "query"], rowLimit: 5000 } }),
  ]);

  // Only the client's own site: a domain property also covers subdomains like
  // a staff portal, whose "/" must not be read as the homepage.
  const site = bareDomain(domain);
  const ours = (u: string) => !site || hostOf(u) === site;

  const originCounts = new Map<string, number>();
  const pages = new Map<string, GscPage>();
  for (const row of byPage.rows || []) {
    const url0 = row.keys[0];
    if (!ours(url0)) continue;
    try {
      const o = new URL(url0).origin;
      originCounts.set(o, (originCounts.get(o) || 0) + row.impressions);
    } catch { /* ignore */ }
    const p = normalizePath(url0);
    const existing = pages.get(p);
    if (existing) {
      // Fold URL variants (#fragments, trailing slashes) into one path, keeping
      // the variant Google shows most as the URL to inspect.
      const bestUrl = row.impressions > existing.impressions ? url0 : existing.url;
      const imp = existing.impressions + row.impressions;
      existing.url = bestUrl;
      existing.position = imp ? (existing.position * existing.impressions + row.position * row.impressions) / imp : 0;
      existing.clicks += row.clicks;
      existing.impressions = imp;
      existing.ctr = imp ? existing.clicks / imp : 0;
    } else {
      pages.set(p, { path: p, url: url0, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, queries: [] });
    }
  }

  for (const row of byPageQuery.rows || []) {
    if (!ours(row.keys[0])) continue;
    const page = pages.get(normalizePath(row.keys[0]));
    if (!page) continue;
    const existing = page.queries.find((q) => q.query === row.keys[1]);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
    } else {
      page.queries.push({ query: row.keys[1], clicks: row.clicks, impressions: row.impressions, position: row.position });
    }
  }
  for (const page of pages.values()) {
    page.queries = page.queries.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 10);
  }

  const origin = [...originCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { pages: [...pages.values()], origin, startDate: body.startDate, endDate: body.endDate };
}

// ── Index status ────────────────────────────────────────────────────────────

export interface IndexStatus {
  url: string;
  indexed: boolean;
  coverage: string; // Google's wording, e.g. "Crawled - currently not indexed"
  reason: string | null; // plain-language why, when not indexed
  fixes: string[]; // what to do about it
  lastCrawl: string | null;
  inSitemap: boolean;
  hasInternalLinks: boolean;
  inspectUrl: string; // opens Search Console's URL Inspection, where "Request indexing" lives
}

interface InspectionResponse {
  inspectionResult?: {
    inspectionResultLink?: string;
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      sitemap?: string[];
      referringUrls?: string[];
    };
  };
}

export function searchConsoleInspectLink(property: string, url: string) {
  return `https://search.google.com/search-console/inspect?resource_id=${enc(property)}&id=${enc(url)}`;
}

export async function inspectUrl(property: string, url: string): Promise<IndexStatus> {
  const data = await gscRequest<InspectionResponse>("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    data: { inspectionUrl: url, siteUrl: property, languageCode: "en-US" },
  });
  const r = data.inspectionResult?.indexStatusResult || {};
  const coverage = r.coverageState || "Unknown to Google";
  const indexed = r.verdict === "PASS" || (/indexed/i.test(coverage) && !/not indexed/i.test(coverage));
  // Google often leaves `sitemap` empty even for "Submitted and indexed" pages;
  // "Submitted" itself means it came from a sitemap.
  const inSitemap = (r.sitemap || []).length > 0 || /submitted/i.test(coverage);
  const hasInternalLinks = (r.referringUrls || []).length > 0;

  let reason: string | null = null;
  const fixes: string[] = [];
  if (!indexed) {
    if (r.indexingState === "BLOCKED_BY_META_TAG") {
      reason = "The page has a noindex tag, which tells Google not to index it.";
      fixes.push("Turn off \"Exclude this page from search results\" in the page's Webflow SEO settings, then republish.");
    } else if (r.indexingState === "BLOCKED_BY_HTTP_HEADER") {
      reason = "The server sends a header telling Google not to index this page.";
      fixes.push("Remove the X-Robots-Tag noindex header for this URL.");
    } else if (r.robotsTxtState === "DISALLOWED") {
      reason = "robots.txt blocks Google from crawling this page.";
      fixes.push("Remove the rule blocking this path in robots.txt (Webflow: Site settings → SEO → robots.txt).");
    } else if (r.pageFetchState && r.pageFetchState !== "SUCCESSFUL" && r.pageFetchState !== "PAGE_FETCH_STATE_UNSPECIFIED") {
      const fetchCopy: Record<string, string> = {
        SOFT_404: "Google thinks the page is empty or an error page (a \"soft 404\").",
        NOT_FOUND: "The page returns a 404 (not found) to Google.",
        SERVER_ERROR: "The server returned an error when Google tried to load the page.",
        REDIRECT_ERROR: "The page redirects in a way Google can't follow.",
        ACCESS_DENIED: "Google was blocked from loading the page (login or permissions).",
        BLOCKED_ROBOTS_TXT: "robots.txt blocks Google from loading the page.",
      };
      reason = fetchCopy[r.pageFetchState] || `Google couldn't load the page (${r.pageFetchState.toLowerCase().replace(/_/g, " ")}).`;
      fixes.push(r.pageFetchState === "SOFT_404" ? "Add substantial, unique content so the page clearly isn't empty." : "Make sure the page loads normally for logged-out visitors.");
    } else if (r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical) {
      reason = `Google treats another URL as the main version of this page: ${r.googleCanonical}`;
      fixes.push("Make this page clearly different from that one, or point its canonical tag there on purpose and drop it from the sitemap.");
    } else if (/crawled - currently not indexed/i.test(coverage)) {
      reason = "Google read the page but decided it isn't worth indexing yet, usually because it's thin or too similar to other pages.";
      fixes.push("Expand the page with specific, useful content that answers what searchers want.");
      fixes.push("Link to it from 2-3 related pages that already rank.");
    } else if (/discovered - currently not indexed/i.test(coverage)) {
      reason = "Google knows the page exists but hasn't crawled it yet, often a sign it doesn't look important.";
      fixes.push("Link to it from the homepage or main navigation, or from related pages.");
    } else {
      reason = "Google hasn't found this page yet.";
      fixes.push("Make sure the page is in the sitemap and linked from at least one other page.");
    }
    if (!inSitemap) fixes.push("Add the page to the sitemap (Webflow does this automatically for published pages unless excluded).");
    if (!hasInternalLinks) fixes.push("Google has seen no links pointing to this page. Link to it from related pages.");
    fixes.push("Then use Search Console's \"Request indexing\" button for this URL.");
  }

  return {
    url,
    indexed,
    coverage,
    reason,
    fixes: [...new Set(fixes)],
    lastCrawl: r.lastCrawlTime || null,
    inSitemap,
    hasInternalLinks,
    inspectUrl: searchConsoleInspectLink(property, url),
  };
}

// ── Sitemaps ────────────────────────────────────────────────────────────────

export async function resubmitSitemaps(property: string, origin: string): Promise<string[]> {
  const list = await gscRequest<{ sitemap?: { path: string }[] }>(`${WM}/sites/${enc(property)}/sitemaps`);
  const paths = (list.sitemap || []).map((s) => s.path);
  if (paths.length === 0) paths.push(`${origin.replace(/\/$/, "")}/sitemap.xml`);
  for (const p of paths) {
    await gscRequest(`${WM}/sites/${enc(property)}/sitemaps/${enc(p)}`, { method: "PUT", write: true });
  }
  return paths;
}
