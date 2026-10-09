import type { ClientConfig } from "./clients";
import { getDb } from "./db";
import { resolveProperty, type GscPage, type IndexStatus } from "./gsc";
import { cachedInspections, cachedPerformance } from "./gsc-cache";
import { getSeRankingData } from "./seranking";
import { getAiVisibility, type AiVisibility } from "./airt";
import { ensureClaritySnapshot, getClaritySummary } from "./clarity";
import { normalizePath, type ClarityPage } from "./page-behavior";
import { fetchPage, sitemapUrls } from "./page-fetch";
import { brandTerms, classifyKeyword, type RankedKeyword } from "./keyword-insights";

// The Agents tab's task list. A scan reads every connected source for one
// client and turns what it finds into concrete tasks, each with the evidence
// behind it and an estimated payoff. Rules are plain thresholds on purpose:
// every task can say exactly why it exists.

export type TaskCategory = "ai" | "indexing" | "search" | "upkeep";
export type TaskType = "indexing" | "ctr" | "striking" | "missing_page" | "ai_prompt" | "ai_source" | "ux_leak" | "onpage";
export type TaskStatus = "open" | "drafted" | "applied" | "done" | "dismissed" | "resolved";
export type Impact = "high" | "medium" | "low";

export interface AgentTask {
  key: string;
  type: TaskType;
  category: TaskCategory;
  title: string;
  why: string; // one sentence, plain language
  evidence: string[];
  impact: Impact;
  score: number; // sort order within the list (estimated monthly clicks or mentions at stake)
  path?: string;
  url?: string;
  keywords?: string[];
  prompt?: string;
  domain?: string;
  data?: Record<string, unknown>; // inputs the agent needs, from the scan
}

export interface StoredTask extends AgentTask {
  status: TaskStatus;
  output: unknown | null;
  result: Record<string, unknown> | null;
  updatedAt: string;
}

export interface ScanSummary {
  scannedAt: string;
  sources: { name: string; ok: boolean; note?: string }[];
}

const SCAN_TTL_HOURS = 12;

// Which scan source produces each task type. A task is only auto-resolved
// when its source loaded fine, so an SE Ranking timeout doesn't clear the list.
const TYPE_SOURCE: Record<TaskType, string> = {
  ctr: "Search Console",
  indexing: "Index check",
  striking: "SE Ranking",
  missing_page: "SE Ranking",
  ai_prompt: "AI tracker",
  ai_source: "AI tracker",
  ux_leak: "Clarity",
  onpage: "Live pages",
};

// Typical organic CTR by position. Pages well below this are losing clicks to
// their search snippet, not their ranking.
const EXPECTED_CTR = [0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const expectedCtr = (pos: number) => EXPECTED_CTR[Math.round(pos)] ?? 0.01;

// Rough share of a keyword's monthly searches each position earns, for
// "what is moving up worth" estimates.
const ctrAt = (pos: number) => (pos <= 0 ? 0 : expectedCtr(Math.max(1, pos)));

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");

function impactFrom(score: number, high: number, medium: number): Impact {
  return score >= high ? "high" : score >= medium ? "medium" : "low";
}

function originFor(config: ClientConfig, gscOrigin?: string | null) {
  return gscOrigin || `https://${config.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

function pathOf(url: string) {
  try { return normalizePath(new URL(url).pathname); } catch { return url; }
}

// Pages nobody needs to rank or be cited: legal, hiring, account, and system pages.
const UTILITY_PATH = /^\/(privacy|terms|cookie|legal|disclaimer|accessibility|careers?|jobs|login|log-in|sign-?in|sign-?up|account|cart|checkout|search|thank|404|401|password|unsubscribe|portal)|^\/my[a-z-]*\/?$/i;
const isUtility = (path?: string) => !!path && UTILITY_PATH.test(path);

// Scraper and bot searches that inflate impressions without real people
// behind them: mojibake ("bã??â¡ez") and stacked exact-match operators.
export function isJunkQuery(q: string) {
  return /[ÃâƒÂ�]|\?\?/.test(q) || (q.match(/"/g) || []).length >= 4;
}

// ── Rules ───────────────────────────────────────────────────────────────────

function ctrTasks(pages: GscPage[], brands: string[]): AgentTask[] {
  const tasks: AgentTask[] = [];
  for (const raw of pages) {
    if (isUtility(raw.path)) continue;
    // Work from the real searches Google reports for the page, without bot
    // queries; page totals include junk and anonymized searches we can't judge.
    // Brand searches on inner pages are sitelinks under the homepage; their
    // CTR is low by design, so they only count for the homepage.
    const clean = raw.queries.filter((q) => !isJunkQuery(q.query) && (raw.path === "/" || !classifyKeyword(q.query, brands).branded));
    const junkImpr = raw.queries.filter((q) => isJunkQuery(q.query)).reduce((s, q) => s + q.impressions, 0);
    const impressions = clean.reduce((s, q) => s + q.impressions, 0);
    if (impressions < 150) continue;
    const clicks = clean.reduce((s, q) => s + q.clicks, 0);
    const position = clean.reduce((s, q) => s + q.position * q.impressions, 0) / impressions;
    const p = { ...raw, impressions, clicks, position, ctr: clicks / impressions };
    if (p.position > 12) continue;
    const expected = expectedCtr(p.position);
    if (p.ctr >= expected * 0.6) continue;
    const missed = p.impressions * (expected - p.ctr);
    if (missed < 5) continue;
    const top = clean.slice(0, 5);
    tasks.push({
      key: `ctr:${p.path}`,
      type: "ctr",
      category: "search",
      title: `Rewrite the Google snippet for ${p.path}`,
      why: `For the searches Google reports, it shows this page ${fmtNum(p.impressions)} times a month around position ${p.position.toFixed(1)}, but only ${pct(p.ctr)} click. Pages there usually get about ${pct(expected)}.`,
      evidence: [
        `About ${fmtNum(missed)} extra clicks a month if the snippet matched a typical page at this position`,
        ...(junkImpr ? [`Left out ${fmtNum(junkImpr)} impressions from bot searches`] : []),
        ...top.map((q) => `“${q.query}”: ${fmtNum(q.impressions)} impressions, position ${q.position.toFixed(1)}`),
      ],
      impact: impactFrom(missed, 30, 10),
      score: missed,
      path: p.path,
      url: p.url,
      keywords: top.map((q) => q.query),
      data: { impressions: p.impressions, ctr: p.ctr, position: p.position, queries: top },
    });
  }
  return tasks;
}

function strikingTasks(keywords: RankedKeyword[]): AgentTask[] {
  const byPage = new Map<string, RankedKeyword[]>();
  for (const k of keywords) {
    if (k.type?.branded || !k.landingPath || isUtility(k.landingPath) || k.position < 4 || k.position > 20) continue;
    if ((k.volume ?? 0) < 10) continue;
    byPage.set(k.landingPath, [...(byPage.get(k.landingPath) || []), k]);
  }
  const tasks: AgentTask[] = [];
  for (const [path, kws] of byPage) {
    const sorted = kws.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 4);
    const lead = sorted[0];
    // Clicks gained by reaching position 3 for each keyword.
    const gain = sorted.reduce((s, k) => s + (k.volume ?? 0) * Math.max(0, ctrAt(3) - ctrAt(k.position)), 0);
    tasks.push({
      key: `striking:${path}`,
      type: "striking",
      category: "search",
      title: lead.position > 10
        ? `Push ${path} onto page one for “${lead.keyword}”`
        : `Move ${path} into the top 3 for “${lead.keyword}”`,
      why: `This page already ranks #${lead.position} for “${lead.keyword}” (${fmtNum(lead.volume ?? 0)} searches a month). A content refresh is the fastest win in SEO: Google already trusts the page.`,
      evidence: sorted.map((k) => `“${k.keyword}”: #${k.position}${k.delta ? ` (${k.delta > 0 ? "+" : ""}${k.delta} this week)` : ""}, ${fmtNum(k.volume ?? 0)} searches/mo`),
      impact: impactFrom(gain, 40, 10),
      score: gain,
      path,
      url: lead.landingUrl || undefined,
      keywords: sorted.map((k) => k.keyword),
      data: { keywords: sorted.map((k) => ({ keyword: k.keyword, position: k.position, volume: k.volume })) },
    });
  }
  return tasks;
}

function missingPageTasks(keywords: RankedKeyword[], gscQueries: Set<string>): AgentTask[] {
  return keywords
    .filter((k) => !k.type?.branded && !k.landingPath && (k.position === 0 || k.position > 30) && (k.volume ?? 0) >= 20)
    .filter((k) => !gscQueries.has(k.keyword.toLowerCase()))
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 5)
    .map((k) => {
      const gain = (k.volume ?? 0) * ctrAt(5);
      return {
        key: `missing:${k.keyword.toLowerCase()}`,
        type: "missing_page" as const,
        category: "search" as const,
        title: `Create a page that answers “${k.keyword}”`,
        why: `${fmtNum(k.volume ?? 0)} people search this a month and the site has no page Google ranks for it${k.position > 0 ? ` (best result is #${k.position})` : ""}.`,
        evidence: [
          `Tracked keyword in SE Ranking, ${k.type?.label || "non-brand"}`,
          k.position > 0 ? `Currently #${k.position}` : "Not in the top 100",
          `Roughly ${fmtNum(gain)} clicks a month at position 5`,
        ],
        impact: impactFrom(gain, 25, 8),
        score: gain,
        keywords: [k.keyword],
        data: { keyword: k.keyword, volume: k.volume, intent: k.type?.intent },
      };
    });
}

function indexingTasks(statuses: IndexStatus[], gscByPath: Map<string, GscPage>, rankingPaths: Set<string>): AgentTask[] {
  return statuses
    .filter((s) => !s.indexed && !isUtility(pathOf(s.url)))
    .map((s) => {
      const path = pathOf(s.url);
      const important = path === "/" || rankingPaths.has(path) || gscByPath.has(path);
      const score = (path === "/" ? 100 : 0) + (rankingPaths.has(path) ? 40 : 0) + 20;
      return {
        key: `indexing:${path}`,
        type: "indexing" as const,
        category: "indexing" as const,
        title: `Get ${path} indexed by Google`,
        why: s.reason || `Google reports “${s.coverage}”, so this page can't show up in search or AI Overviews.`,
        evidence: [
          `Google says: ${s.coverage}`,
          s.lastCrawl ? `Last crawled ${s.lastCrawl.slice(0, 10)}` : "Google hasn't crawled it yet",
          s.inSitemap ? "Listed in the sitemap" : "Not in a sitemap Google has read",
          s.hasInternalLinks ? "Other pages link to it" : "Google found no internal links to it",
          ...s.fixes.slice(0, 3),
        ],
        impact: (important ? "high" : "medium") as Impact,
        score,
        path,
        url: s.url,
        data: { status: s },
      };
    });
}

function aiPromptTasks(ai: AiVisibility): AgentTask[] {
  const engineName = new Map(ai.engines.map((e) => [e.id, e.name]));
  const tasks: AgentTask[] = [];
  for (const p of ai.prompts) {
    const answered = Object.entries(p.byEngine).filter(([, r]) => r.mentionPosition !== null);
    const missed = answered.filter(([, r]) => r.mentionPosition === 0);
    if (answered.length === 0 || missed.length === 0) continue;
    const named = answered.filter(([, r]) => (r.mentionPosition ?? 0) > 0);
    const missedNames = missed.map(([id]) => engineName.get(Number(id)) || "AI");
    const crowded = missed.reduce((s, [, r]) => s + (r.mentionsCount ?? 0), 0);
    const score = missed.length * 20 + crowded;
    const first = missed[0];
    tasks.push({
      key: `ai_prompt:${p.prompt.toLowerCase().slice(0, 120)}`,
      type: "ai_prompt",
      category: "ai",
      title: `Get recommended when people ask: “${p.prompt.length > 90 ? `${p.prompt.slice(0, 87)}…` : p.prompt}”`,
      why: `${missedNames.join(" and ")} ${missed.length > 1 ? "answer" : "answers"} this without naming ${ai.brand || "the brand"}${crowded ? `, while naming ${crowded} other ${crowded === 1 ? "company" : "companies"}` : ""}.`,
      evidence: [
        ...missed.map(([id, r]) => `${engineName.get(Number(id)) || "AI"}: not mentioned${r.mentionsCount ? `, ${r.mentionsCount} brands named instead` : ""}`),
        ...named.map(([id, r]) => `${engineName.get(Number(id)) || "AI"}: named at position ${r.mentionPosition}`),
      ],
      impact: missed.length === answered.length ? "high" : "medium",
      score,
      prompt: p.prompt,
      data: {
        prompt: p.prompt,
        brand: ai.brand,
        // Lets the agent read the actual answer it needs to beat.
        answerRef: { llmId: Number(first[0]), promptLlmId: first[1].promptLlmId, date: first[1].date },
      },
    });
  }
  return tasks;
}

function aiSourceTasks(ai: AiVisibility): AgentTask[] {
  return ai.sources
    .filter((s) => !s.isYou && !s.mentionsYou && s.aiAnswers >= 2)
    .sort((a, b) => b.aiAnswers - a.aiAnswers)
    .slice(0, 5)
    .map((s) => ({
      key: `ai_source:${s.domain}`,
      type: "ai_source" as const,
      category: "ai" as const,
      title: `Get ${ai.brand || "the brand"} mentioned on ${s.domain}`,
      why: `AI engines cited ${s.domain} in ${s.aiAnswers} answers to your tracked prompts, and it doesn't mention ${ai.brand || "you"}. Being on the pages AI reads is how brands get recommended.`,
      evidence: [
        `Cited in ${s.aiAnswers} AI answers across ${s.prompts} prompts`,
        `Mentions tracked brands in ${Math.round(s.mentionRatePct)}% of those answers`,
        ...(s.domainTrust != null ? [`Domain trust ${s.domainTrust}`] : []),
      ],
      impact: impactFrom(s.aiAnswers, 6, 3),
      score: s.aiAnswers * 8,
      domain: s.domain,
      data: { domain: s.domain, aiAnswers: s.aiAnswers, prompts: s.prompts, brand: ai.brand, trackedPrompts: ai.prompts.map((p) => p.prompt).slice(0, 10) },
    }));
}

const ISSUE_LABEL: Record<string, string> = {
  rage: "rage clicks (repeated clicking on something that doesn't respond)",
  dead: "dead clicks (clicking things that aren't links)",
  quickback: "quick backs (leaving within seconds)",
  error: "JavaScript errors on click",
};

function uxTasks(pages: ClarityPage[], origin: string): AgentTask[] {
  return pages
    .filter((p) => p.sessions >= 10 && p.frustratedPct >= 10 && p.topIssue)
    .sort((a, b) => b.sessions * b.frustratedPct - a.sessions * a.frustratedPct)
    .slice(0, 4)
    .map((p) => {
      const affected = (p.sessions * p.frustratedPct) / 100;
      return {
        key: `ux:${p.path}`,
        type: "ux_leak" as const,
        category: "upkeep" as const,
        title: `Fix what's frustrating visitors on ${p.path}`,
        why: `${Math.round(p.frustratedPct)}% of visits to this page hit ${ISSUE_LABEL[p.topIssue!.kind] || p.topIssue!.kind}.`,
        evidence: [
          `${fmtNum(p.sessions)} Clarity sessions in the last 30 days`,
          `Rage clicks ${p.rageClicks}, dead clicks ${p.deadClicks}, quick backs ${p.quickbacks}, error clicks ${p.errorClicks}`,
          `Visitors scroll ${Math.round(p.scrollDepth)}% of the page on average`,
        ],
        impact: impactFrom(affected, 20, 5),
        score: affected,
        path: p.path,
        url: `${origin}${p.path}`,
        data: { clarity: p },
      };
    });
}

async function onPageTasks(urls: string[]): Promise<AgentTask[]> {
  const snaps = await Promise.all(urls.map((u) => fetchPage(u)));
  const tasks: AgentTask[] = [];
  for (const [i, s] of snaps.entries()) {
    if (!s.ok) continue;
    const path = pathOf(urls[i]);
    if (isUtility(path)) continue;
    const issues: string[] = [];
    if (s.robotsNoindex) issues.push("The page tells search engines not to index it (meta robots noindex)");
    if (!s.title) issues.push("No title tag");
    else if (s.title.length > 65) issues.push(`Title is ${s.title.length} characters; Google cuts it off around 60`);
    else if (s.title.length < 25) issues.push(`Title is only ${s.title.length} characters: “${s.title}”`);
    if (!s.metaDescription) issues.push("No meta description, so Google writes its own snippet");
    else if (s.metaDescription.length > 165) issues.push(`Meta description is ${s.metaDescription.length} characters; Google shows about 155`);
    if (s.h1.length === 0) issues.push("No H1 heading");
    else if (s.h1.length > 1) issues.push(`${s.h1.length} H1 headings; use one`);
    if (s.jsonLdTypes.length === 0) issues.push("No structured data (JSON-LD). AI engines and Google rely on it to understand the business");
    if (issues.length === 0) continue;
    const weight = (path === "/" ? 3 : 1) * (s.robotsNoindex ? 4 : 1);
    tasks.push({
      key: `onpage:${path}`,
      type: "onpage",
      category: "upkeep",
      title: `Fix on-page basics on ${path}`,
      why: `${issues.length} ${issues.length === 1 ? "thing" : "things"} on this page make it harder for Google and AI engines to read.`,
      evidence: issues,
      impact: s.robotsNoindex || (path === "/" && issues.length >= 2) ? "high" : issues.length >= 3 ? "medium" : "low",
      score: issues.length * 3 * weight,
      path,
      url: s.url,
      data: { title: s.title, metaDescription: s.metaDescription, h1: s.h1, jsonLdTypes: s.jsonLdTypes },
    });
  }
  return tasks;
}

// ── Scan ────────────────────────────────────────────────────────────────────

async function cachedAi(slug: string, siteId: string, domain: string): Promise<AiVisibility> {
  const db = await getDb();
  const cached = await db.execute({
    sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'ai_visibility' AND date_range = '30d'
          AND fetched_at > datetime('now', '-6 hours')`,
    args: [slug],
  });
  if (cached.rows.length > 0) return JSON.parse(cached.rows[0].data as string);
  return getAiVisibility(siteId, 30, domain);
}

export async function scanClient(slug: string, config: ClientConfig): Promise<{ tasks: AgentTask[]; summary: ScanSummary }> {
  const sources: ScanSummary["sources"] = [];
  const tasks: AgentTask[] = [];
  const note = (name: string, ok: boolean, msg?: string) => sources.push({ name, ok, note: msg });

  // Search Console + SE Ranking + AI tracker + Clarity load in parallel.
  const property = await resolveProperty(config).catch(() => null);
  const siteId = config.integrations.seRanking?.enabled ? config.integrations.seRanking.projectId : "";
  const [gscRes, srRes, aiRes, clarityRes] = await Promise.allSettled([
    property ? cachedPerformance(slug, property, config.domain, "30d", 30) : Promise.reject(new Error("Search Console isn't connected")),
    siteId && process.env.SERANKING_API_KEY ? getSeRankingData(config, process.env.SERANKING_API_KEY) : Promise.reject(new Error("SE Ranking isn't connected")),
    siteId && process.env.SERANKING_API_KEY ? cachedAi(slug, siteId, config.domain) : Promise.reject(new Error("SE Ranking isn't connected")),
    config.integrations.clarity?.enabled
      ? ensureClaritySnapshot(slug, config).then((e) => getClaritySummary(slug, config, 30, e))
      : Promise.reject(new Error("Clarity isn't connected")),
  ]);

  const gsc = gscRes.status === "fulfilled" ? gscRes.value : null;
  const sr = srRes.status === "fulfilled" ? srRes.value : null;
  const ai = aiRes.status === "fulfilled" ? aiRes.value : null;
  const clarity = clarityRes.status === "fulfilled" ? clarityRes.value : null;
  const reason = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? String((r.reason as Error)?.message || r.reason).slice(0, 140) : undefined);
  note("Search Console", !!gsc, reason(gscRes));
  note("SE Ranking", !!sr, reason(srRes));
  note("AI tracker", !!ai && ai.status === "ok", ai && ai.status !== "ok" ? (ai.status === "collecting" ? "Still collecting first answers" : "Not set up") : reason(aiRes));
  note("Clarity", !!clarity && clarity.status === "ok", clarity && clarity.status !== "ok" ? clarity.message || clarity.status : reason(clarityRes));

  const origin = originFor(config, gsc?.origin);
  const gscPages = (gsc?.pages || []).sort((a, b) => b.impressions - a.impressions);
  const gscByPath = new Map(gscPages.map((p) => [p.path, p]));
  const keywords = sr?.allKeywords || [];
  const rankingPaths = new Set(keywords.filter((k) => k.landingPath && k.position > 0).map((k) => k.landingPath!));

  if (gsc) tasks.push(...ctrTasks(gscPages, brandTerms(config.name, config.domain)));
  if (sr) {
    const gscQueries = new Set(gscPages.flatMap((p) => p.queries.map((q) => q.query.toLowerCase())));
    tasks.push(...strikingTasks(keywords), ...missingPageTasks(keywords, gscQueries));
  }
  if (ai?.status === "ok") tasks.push(...aiPromptTasks(ai), ...aiSourceTasks(ai));
  if (clarity?.status === "ok") tasks.push(...uxTasks(clarity.pages, origin));

  // Indexing: the pages most likely to be missing from Google are the ones in
  // the sitemap that never get an impression, plus the homepage.
  const [sitemap, onpage] = await Promise.all([
    sitemapUrls(origin).catch(() => [] as string[]),
    onPageTasks([...new Set([`${origin}/`, ...gscPages.slice(0, 7).map((p) => p.url)])]).catch(() => [] as AgentTask[]),
  ]);
  tasks.push(...onpage);
  note("Live pages", true, `Checked ${Math.min(8, gscPages.length + 1)} pages`);

  if (property) {
    const noImpressions = sitemap.filter((u) => !gscByPath.has(pathOf(u)) && !isUtility(pathOf(u)));
    const candidates = [...new Set([`${origin}/`, ...noImpressions])].slice(0, 12);
    const statuses: Record<string, IndexStatus> = {};
    try {
      await cachedInspections(slug, property, candidates, false, statuses);
      note("Index check", true, `Inspected ${Object.keys(statuses).length} pages${sitemap.length ? ` (${noImpressions.length} sitemap pages have no impressions)` : ""}`);
    } catch (err) {
      note("Index check", Object.keys(statuses).length > 0, String((err as Error)?.message || err).slice(0, 140));
    }
    tasks.push(...indexingTasks(Object.values(statuses), gscByPath, rankingPaths));
  }

  const unique = [...new Map(tasks.map((t) => [t.key, t])).values()];
  return { tasks: unique, summary: { scannedAt: new Date().toISOString(), sources } };
}

// ── Storage ─────────────────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): StoredTask {
  return {
    ...(JSON.parse(row.task as string) as AgentTask),
    status: row.status as TaskStatus,
    output: row.output ? JSON.parse(row.output as string) : null,
    result: row.result ? JSON.parse(row.result as string) : null,
    updatedAt: row.updated_at as string,
  };
}

export async function listTasks(slug: string): Promise<StoredTask[]> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM agent_tasks WHERE client_slug = ?", args: [slug] });
  return res.rows.map((r) => rowToTask(r as Record<string, unknown>));
}

export async function getTask(slug: string, key: string): Promise<StoredTask | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM agent_tasks WHERE client_slug = ? AND task_key = ?", args: [slug, key] });
  return res.rows[0] ? rowToTask(res.rows[0] as Record<string, unknown>) : null;
}

export async function updateTask(
  slug: string,
  key: string,
  patch: { status?: TaskStatus; output?: unknown; result?: Record<string, unknown> }
) {
  const db = await getDb();
  const sets: string[] = ["updated_at = datetime('now')"];
  const args: (string | null)[] = [];
  if (patch.status) { sets.push("status = ?"); args.push(patch.status); }
  if (patch.output !== undefined) { sets.push("output = ?"); args.push(JSON.stringify(patch.output)); }
  if (patch.result !== undefined) { sets.push("result = ?"); args.push(JSON.stringify(patch.result)); }
  await db.execute({ sql: `UPDATE agent_tasks SET ${sets.join(", ")} WHERE client_slug = ? AND task_key = ?`, args: [...args, slug, key] });
}

export async function lastScan(slug: string): Promise<ScanSummary | null> {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'agent_scan' AND date_range = 'all'`,
    args: [slug],
  });
  return res.rows[0] ? JSON.parse(res.rows[0].data as string) : null;
}

export function scanIsStale(summary: ScanSummary | null) {
  return !summary || Date.now() - new Date(summary.scannedAt).getTime() > SCAN_TTL_HOURS * 3_600_000;
}

// Saves a scan: new tasks are added, existing ones get fresh evidence but keep
// their status and drafts, and open tasks the scan no longer finds are marked
// "resolved" (the problem went away on its own).
export async function saveScan(slug: string, tasks: AgentTask[], summary: ScanSummary) {
  const db = await getDb();
  const seen = new Set(tasks.map((t) => t.key));
  for (const t of tasks) {
    await db.execute({
      sql: `INSERT INTO agent_tasks (client_slug, task_key, task, status) VALUES (?, ?, ?, 'open')
            ON CONFLICT(client_slug, task_key) DO UPDATE SET task = excluded.task,
              status = CASE WHEN agent_tasks.status = 'resolved' THEN 'open' ELSE agent_tasks.status END`,
      args: [slug, t.key, JSON.stringify(t)],
    });
  }
  const okSources = new Set(summary.sources.filter((s) => s.ok).map((s) => s.name));
  const open = await db.execute({ sql: "SELECT task_key, task FROM agent_tasks WHERE client_slug = ? AND status = 'open'", args: [slug] });
  for (const row of open.rows) {
    const key = row.task_key as string;
    const type = (JSON.parse(row.task as string) as AgentTask).type;
    if (!seen.has(key) && okSources.has(TYPE_SOURCE[type])) {
      await db.execute({
        sql: "UPDATE agent_tasks SET status = 'resolved', updated_at = datetime('now') WHERE client_slug = ? AND task_key = ?",
        args: [slug, key],
      });
    }
  }
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
          VALUES (?, 'agent_scan', 'all', ?, datetime('now'))`,
    args: [slug, JSON.stringify(summary)],
  });
}
