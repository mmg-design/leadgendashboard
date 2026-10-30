import { getDb } from "./db";
import type { ClientConfig } from "./clients";
import { getAnalyticsClient, conversionFilterFor } from "./ga-client";
import { dailyTotals, resolveProperty } from "./gsc";
import { serankingFetch } from "./seranking";
import { brandTerms, classifyKeyword } from "./keyword-insights";
import { getAiVisibility, type AiVisibility } from "./airt";
import { listEvents, type SiteEvent } from "./site-events";
import { eventImpact } from "./event-impact";
import { GA_LAG_DAYS, GSC_LAG_DAYS } from "./data-lag";
import { getReviewLink, listFeedback } from "./feedback";

// The client's progress page: a plain-language read of their results, built
// from the same sources as the dashboard. Everything here is safe to show the
// client: no visitor identities, no internal notes, no technical metrics.
//
// The report is built and cached without the team's per-item edits; hiding,
// rewording, and the lead value are applied on every read, so edits in the
// Client page tab show up immediately.

const CACHE_HOURS = 6;
const CACHE_VERSION = "v2";
const DAY = 86_400_000;

// ── Link and settings ───────────────────────────────────────────────────────

export interface PortalSettings {
  startedAt: string | null; // YYYY-MM-DD; falls back to the ClickUp engagement start
  leadValue: number | null; // average value of one lead, for the revenue line
  hidden: string[]; // win and change keys the team hid
  overrides: Record<string, { title?: string; why?: string }>;
  contactName: string | null; // who the monthly update draft is addressed to (team-only)
  contactEmail: string | null;
}

export interface Portal {
  slug: string;
  token: string;
  enabled: boolean;
  settings: PortalSettings;
}

function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
}

function normalizeSettings(raw: unknown): PortalSettings {
  let s: Partial<PortalSettings> = {};
  try { s = typeof raw === "string" ? JSON.parse(raw) : {}; } catch { /* defaults */ }
  const overrides: PortalSettings["overrides"] = {};
  for (const [k, v] of Object.entries(s.overrides || {})) {
    if (!v || typeof v !== "object") continue;
    const o = v as { title?: unknown; why?: unknown };
    const entry: { title?: string; why?: string } = {};
    if (typeof o.title === "string" && o.title.trim()) entry.title = o.title.trim().slice(0, 200);
    if (typeof o.why === "string" && o.why.trim()) entry.why = o.why.trim().slice(0, 600);
    if (entry.title || entry.why) overrides[k] = entry;
  }
  return {
    startedAt: typeof s.startedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.startedAt) ? s.startedAt : null,
    leadValue: typeof s.leadValue === "number" && s.leadValue > 0 ? Math.round(s.leadValue) : null,
    hidden: Array.isArray(s.hidden) ? s.hidden.filter((h): h is string => typeof h === "string") : [],
    overrides,
    contactName: typeof s.contactName === "string" && s.contactName.trim() ? s.contactName.trim().slice(0, 120) : null,
    contactEmail: typeof s.contactEmail === "string" && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s.contactEmail.trim()) ? s.contactEmail.trim().slice(0, 200) : null,
  };
}

function rowToPortal(row: Record<string, unknown>): Portal {
  return {
    slug: row.client_slug as string,
    token: row.token as string,
    enabled: Number(row.enabled) === 1,
    settings: normalizeSettings(row.settings),
  };
}

export async function getPortal(slug: string): Promise<Portal> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM client_portals WHERE client_slug = ?", args: [slug] });
  if (res.rows[0]) return rowToPortal(res.rows[0] as Record<string, unknown>);
  await db.execute({
    sql: "INSERT OR IGNORE INTO client_portals (client_slug, token, enabled, settings) VALUES (?, ?, 0, '{}')",
    args: [slug, randomToken()],
  });
  return getPortal(slug);
}

export async function updatePortal(slug: string, patch: { enabled?: boolean; settings?: Partial<PortalSettings> }) {
  const current = await getPortal(slug);
  const settings = normalizeSettings(JSON.stringify({ ...current.settings, ...(patch.settings || {}) }));
  const db = await getDb();
  await db.execute({
    sql: "UPDATE client_portals SET enabled = ?, settings = ?, updated_at = datetime('now') WHERE client_slug = ?",
    args: [(patch.enabled ?? current.enabled) ? 1 : 0, JSON.stringify(settings), slug],
  });
  return getPortal(slug);
}

// Replaces the link; the old one stops working immediately.
export async function rotatePortalToken(slug: string) {
  await getPortal(slug);
  const db = await getDb();
  await db.execute({
    sql: "UPDATE client_portals SET token = ?, updated_at = datetime('now') WHERE client_slug = ?",
    args: [randomToken(), slug],
  });
  return getPortal(slug);
}

export async function portalForToken(token: string): Promise<Portal | null> {
  if (!token || token.length < 16) return null;
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM client_portals WHERE token = ?", args: [token] });
  return res.rows[0] ? rowToPortal(res.rows[0] as Record<string, unknown>) : null;
}

// ── Report shape ────────────────────────────────────────────────────────────

export interface Metric { value: number; pct: number | null }

export interface PortalPeriod {
  key: "month" | "start";
  eyebrow: string;
  headline: string;
  lede: string;
  compareLabel: string; // after the % change, e.g. "vs the 30 days before"
  found: (Metric & { label: string }) | null;
  leads: Metric | null;
  pageOne: { value: number; gained: number | null; gainedLabel: string } | null;
  value: number | null; // leads × lead value, filled in on read
  valueNote: string | null;
}

export type WinIcon = "rank" | "ai" | "record" | "page" | "impact" | "leads";
export interface PortalWin { key: string; icon: WinIcon; title: string; detail: string; day: string; hidden?: boolean }

export interface PortalChange {
  key: string;
  day: string;
  kind: "improvement" | "page" | "request";
  title: string;
  why: string | null;
  result: { tone: "good" | "wait"; text: string } | null;
  hidden?: boolean;
  edited?: boolean;
}

export interface PortalKeyword { keyword: string; position: number; startPosition: number | null; volume: number | null; history: (number | null)[] }

export interface PortalRequest {
  id: number;
  status: "open" | "in_progress" | "resolved";
  day: string;
  body: string;
  reply: string | null;
  page: string;
  device: string;
  link: string;
}

export interface PortalReport {
  client: { name: string; domain: string; iconUrl: string | null };
  generatedAt: string;
  startedAt: string;
  startedLabel: string; // "May 2026"
  periods: PortalPeriod[];
  weekly: { week: string; visits: number }[];
  wins: PortalWin[];
  changes: PortalChange[];
  rankings: { pageOne: number; top3: number; pageOneAtStart: number | null; trackedSince: string; rows: PortalKeyword[] } | null;
  requests: PortalRequest[];
  ai: { mentioned: number; total: number; rows: { prompt: string; engines: string[] }[] } | null;
  reviewPath: string;
  sources: { name: string; ok: boolean; note?: string }[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(new Date(new Date(`${day}T12:00:00Z`).getTime() + n * DAY));
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / DAY);
const pct = (before: number, after: number) => (before > 0 ? Math.round(((after - before) / before) * 100) : null);
const monthLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const n = (v: number) => v.toLocaleString("en-US");
const sumRange = (rows: { date: string; v: number }[], from: string, to: string) =>
  rows.filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.v, 0);
const gaDay = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

// "/sports-medicine/" → "Sports Medicine"; the homepage reads as "Homepage".
// Long slugs (blog posts) read in sentence case instead.
export function pageName(path: string) {
  const last = path.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  if (!last) return "Homepage";
  const words = decodeURIComponent(last).replace(/[-_]+/g, " ").trim();
  return words.split(" ").length > 4 ? words.charAt(0).toUpperCase() + words.slice(1) : words.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Agents task titles are written for the team, in the imperative and with
// paths ("Rewrite the Google snippet for /about-us"). The client reads what
// was done, in past tense, with page names.
const page = (path: string) =>
  path.replace(/\/+$/, "") === "" ? "your homepage"
  : /^\/(blog|news|articles?|resources|insights)\//.test(path) ? `your article “${pageName(path)}”`
  : `your ${pageName(path)} page`;
const TITLE_RULES: [RegExp, (...m: string[]) => string][] = [
  [/^Rewrite the Google snippet for (\S+)$/, (p) => `Rewrote how ${page(p)} appears in Google search`],
  [/^Create a page that answers (.+)$/, (q) => `Created a page that answers ${q}`],
  [/^Get (\S+) indexed by Google$/, (p) => `Got ${page(p)} into Google search`],
  [/^Get recommended when people ask: (.+)$/, (q) => `Worked on getting you recommended by AI assistants for ${q}`],
  [/^Get .+ mentioned on (\S+)$/, (d) => `Worked on getting you mentioned on ${d}`],
  [/^Fix what's frustrating visitors on (\S+)$/, (p) => `Fixed what was frustrating visitors on ${page(p)}`],
  [/^Fix on-page basics on (\S+)$/, (p) => `Fixed the search basics on ${page(p)}`],
];
const PAST: Record<string, string> = {
  add: "Added", build: "Built", create: "Created", expand: "Expanded", fix: "Fixed", get: "Got", improve: "Improved",
  link: "Linked", make: "Made", publish: "Published", remove: "Removed", rewrite: "Rewrote", submit: "Submitted",
  update: "Updated", write: "Wrote", move: "Moved", shorten: "Shortened", answer: "Answered",
};
export function clientTitle(title: string) {
  const t = title.replace(/^Published: /, "").trim();
  for (const [re, fn] of TITLE_RULES) {
    const m = t.match(re);
    if (m) return fn(...m.slice(1));
  }
  const withPages = t.replace(/(^|\s)(\/[\w\-/.%]*)/g, (_, sp: string, path: string) => `${sp}${page(path)}`);
  return withPages.replace(/^(\w+)/, (w) => PAST[w.toLowerCase()] || w);
}

async function safe<T>(name: string, sources: PortalReport["sources"], fn: () => Promise<T>, note?: string): Promise<T | null> {
  try {
    const v = await fn();
    sources.push({ name, ok: true });
    return v;
  } catch (err) {
    console.error(`Portal ${name} error:`, err);
    sources.push({ name, ok: false, note: note || (err instanceof Error ? err.message.slice(0, 160) : "Failed to load") });
    return null;
  }
}

// ── Sources ─────────────────────────────────────────────────────────────────

async function gaDaily(config: ClientConfig, from: string, to: string) {
  const propertyId = config.integrations.googleAnalytics?.propertyId;
  if (!config.integrations.googleAnalytics?.enabled || !propertyId) return null;
  const ga = getAnalyticsClient();
  const property = `properties/${propertyId}`;
  const dateRanges = [{ startDate: from, endDate: to }];
  const [visits, ...goals] = await Promise.all([
    ga.runReport({ property, dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }], limit: 2000 }),
    ...config.goals.map((goal) =>
      ga.runReport({ property, dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "eventCount" }], dimensionFilter: conversionFilterFor(goal), limit: 2000 })
    ),
  ]);
  const rows = (r: typeof visits) => (r[0]?.rows || []).map((row) => ({ date: gaDay(row.dimensionValues?.[0]?.value || ""), v: Number(row.metricValues?.[0]?.value || 0) }));
  const leadsByDay = new Map<string, number>();
  for (const g of goals) for (const r of rows(g)) leadsByDay.set(r.date, (leadsByDay.get(r.date) || 0) + r.v);
  return {
    visits: rows(visits),
    leads: config.goals.length ? [...leadsByDay].map(([date, v]) => ({ date, v })) : null,
  };
}

interface RankRow { keyword: string; branded: boolean; volume: number | null; series: { date: string; pos: number }[] }

async function rankHistory(config: ClientConfig, from: string, to: string): Promise<RankRow[] | null> {
  const apiKey = process.env.SERANKING_API_KEY;
  const siteId = config.integrations.seRanking?.enabled ? config.integrations.seRanking.projectId : "";
  if (!apiKey || !siteId) return null;
  const [keywords, positions] = await Promise.all([
    serankingFetch("/v1/project-management/keywords", apiKey, { site_id: siteId }),
    serankingFetch("/v1/project-management/sites/positions", apiKey, { site_id: siteId, date_from: from, date_to: to }),
  ]);
  const names = new Map<string, string>();
  for (const k of Array.isArray(keywords) ? keywords : []) names.set(String(k.id), k.name || "");
  const brands = brandTerms(config.name, config.domain);
  const engine = Array.isArray(positions) ? positions[0] : null;
  const rows = ((engine?.keywords || []) as { id: string | number; volume?: number | null; positions?: { date: string; pos: string | number }[] }[])
    .filter((k) => names.get(String(k.id)))
    .map((k) => {
      const keyword = names.get(String(k.id))!;
      return {
        keyword,
        branded: classifyKeyword(keyword, brands).branded,
        volume: k.volume != null ? Number(k.volume) : null,
        series: (k.positions || []).map((p) => ({ date: p.date, pos: Number(p.pos || 0) })).sort((a, b) => a.date.localeCompare(b.date)),
      };
    });
  // The same phrase can be tracked twice (e.g. two locations); keep its best current position.
  const latest = (r: RankRow) => r.series[r.series.length - 1]?.pos || 999;
  const byKeyword = new Map<string, RankRow>();
  for (const r of rows) {
    const k = r.keyword.trim().toLowerCase();
    const prev = byKeyword.get(k);
    if (!prev || latest(r) < latest(prev)) byKeyword.set(k, r);
  }
  return [...byKeyword.values()];
}

async function aiVisibility(slug: string, config: ClientConfig): Promise<AiVisibility | null> {
  const siteId = config.integrations.seRanking?.enabled ? config.integrations.seRanking.projectId : "";
  if (!siteId || !process.env.SERANKING_API_KEY) return null;
  const db = await getDb();
  // The AI Visibility tab caches the same 30-day read; reuse it while it's fresh.
  const cached = await db.execute({
    sql: "SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'ai_visibility' AND date_range = '30d' AND fetched_at > datetime('now', '-24 hours')",
    args: [slug],
  });
  if (cached.rows[0]) return JSON.parse(cached.rows[0].data as string);
  const data = await getAiVisibility(siteId, 30, config.domain);
  if (data.status !== "not_set_up") {
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at) VALUES (?, 'ai_visibility', '30d', ?, datetime('now'))`,
      args: [slug, JSON.stringify(data)],
    });
  }
  return data;
}

// ── Build ───────────────────────────────────────────────────────────────────

const CHANGE_KINDS = new Set(["agent_task", "published", "page_added", "feedback_resolved"]);

// One entry per piece of work: an Agents task marked done and later published
// is a single change, dated when it went live.
function groupKey(e: SiteEvent) {
  if (e.ref.startsWith("task:feedback:")) return e.ref.slice(5);
  if (e.ref.startsWith("task:")) return e.ref;
  // publish:<task key>:<ISO time>; task keys can contain colons ("ctr:/about").
  if (e.ref.startsWith("publish:")) return `task:${e.ref.match(/^publish:(.+?):\d{4}-\d{2}-\d{2}/)?.[1] || e.ref.slice(8)}`;
  return e.ref;
}

function resultText(impact: Awaited<ReturnType<typeof eventImpact>>): PortalChange["result"] {
  if (!impact) return null;
  if (impact.status === "measuring") {
    const left = Math.max(1, impact.window - impact.daysAfter + GSC_LAG_DAYS);
    return { tone: "wait", text: `Measuring · results in about ${left >= 10 ? "2 weeks" : `${left} days`}` };
  }
  if (impact.status !== "ok" || !impact.change) return null;
  const clicks = impact.change.clicksPct;
  const site = impact.site?.clicksPct;
  // Only gains are reported here; the team sees the full before/after in the dashboard.
  if (clicks == null || clicks <= 0) return null;
  const scope = impact.scope === "page" ? "Clicks from Google to this page" : "Clicks from Google";
  const vsSite = impact.scope === "page" && site != null && site < clicks
    ? `, while your site overall ${site >= 0 ? `grew ${Math.round(site)}%` : `was down ${Math.round(-site)}%`}`
    : "";
  return { tone: "good", text: `${scope} +${Math.round(clicks)}% since${vsSite}` };
}

export async function buildReport(slug: string, config: ClientConfig, settings: PortalSettings): Promise<PortalReport> {
  const sources: PortalReport["sources"] = [];
  const today = iso(new Date());
  const gscEnd = addDays(today, -GSC_LAG_DAYS);
  const events = await listEvents(slug, 480);

  // Start of the engagement: set on the page, else ClickUp's, else the first
  // change we logged, else six months back. Search Console keeps 16 months.
  const earliestEvent = events.filter((e) => CHANGE_KINDS.has(e.kind)).map((e) => e.day).sort()[0];
  const startedAt = [settings.startedAt || config.integrations.clickup?.engagementStartDate || earliestEvent || addDays(today, -180), addDays(today, -475)].sort().reverse()[0];
  const sinceStart = daysBetween(startedAt, today);

  const last30From = addDays(today, -30), last30To = addDays(today, -1);
  const prev30From = addDays(today, -60), prev30To = addDays(today, -31);
  const first30To = addDays(startedAt, 29);
  const weeksFrom = addDays(today, -26 * 7 - 7);
  const dataFrom = [startedAt, prev30From, weeksFrom].sort()[0];

  const property = await resolveProperty(config).catch(() => null);
  const [ga, gsc, ranks, ai] = await Promise.all([
    safe("Google Analytics", sources, () => gaDaily(config, dataFrom, addDays(today, -GA_LAG_DAYS))),
    property
      ? safe("Search Console", sources, async () => (await dailyTotals(property, [dataFrom, addDays(today, -470)].sort().reverse()[0], gscEnd)).map((r) => ({ date: r.date, v: r.clicks })))
      : Promise.resolve(null),
    safe("SE Ranking", sources, () => rankHistory(config, [startedAt, addDays(today, -365)].sort().reverse()[0], today)),
    safe("AI tracking", sources, () => aiVisibility(slug, config)),
  ]);
  if (!config.integrations.googleAnalytics?.enabled) sources.push({ name: "Google Analytics", ok: false, note: "Not connected" });
  if (!property) sources.push({ name: "Search Console", ok: false, note: "Not connected; visits are used instead of Google clicks" });

  // ── Headline numbers
  const gscLast = addDays(gscEnd, -29);
  const foundRows = gsc || ga?.visits || null;
  const foundLabel = gsc ? "People who found you on Google" : "Visits to your website";
  // Search Console runs three days behind, so its 30 days end three days ago.
  const [fFrom, fTo, fPrevFrom, fPrevTo] = gsc ? [gscLast, gscEnd, addDays(gscLast, -30), addDays(gscLast, -1)] : [last30From, last30To, prev30From, prev30To];
  const startPossible = sinceStart >= 60; // a "first month" to compare against

  const foundMonth = foundRows ? { value: sumRange(foundRows, fFrom, fTo), pct: pct(sumRange(foundRows, fPrevFrom, fPrevTo), sumRange(foundRows, fFrom, fTo)) } : null;
  const foundStart = foundRows ? { value: sumRange(foundRows, startedAt, fTo), pct: startPossible ? pct(sumRange(foundRows, startedAt, addDays(startedAt, 29)), sumRange(foundRows, fFrom, fTo)) : null } : null;
  const leadRows = ga?.leads || null;
  const leadsMonth = leadRows ? { value: sumRange(leadRows, last30From, last30To), pct: pct(sumRange(leadRows, prev30From, prev30To), sumRange(leadRows, last30From, last30To)) } : null;
  const leadsStart = leadRows ? { value: sumRange(leadRows, startedAt, last30To), pct: startPossible ? pct(sumRange(leadRows, startedAt, first30To), sumRange(leadRows, last30From, last30To)) : null } : null;

  // ── Rankings (searches for the practice's own name don't count)
  const posAt = (r: RankRow, day: string) => {
    const before = r.series.filter((p) => p.date <= day);
    return (before[before.length - 1] || r.series[0])?.pos ?? 0;
  };
  const generic = (ranks || []).filter((r) => !r.branded && r.series.length);
  const nowPos = (r: RankRow) => r.series[r.series.length - 1].pos;
  const onPageOne = (p: number) => p > 0 && p <= 10;
  const pageOneNow = generic.filter((r) => onPageOne(nowPos(r))).length;
  const pageOne30 = generic.filter((r) => onPageOne(posAt(r, last30From))).length;
  const pageOneStart = generic.filter((r) => onPageOne(r.series[0].pos)).length;
  const trackedSince = generic.map((r) => r.series[0].date).sort()[0] || startedAt;

  let rankings: PortalReport["rankings"] = null;
  if (ranks) {
    const sample = (r: RankRow) => {
      const s = r.series;
      return Array.from({ length: 7 }, (_, i) => s[Math.round((i / 6) * (s.length - 1))]?.pos || null);
    };
    rankings = {
      pageOne: pageOneNow,
      top3: generic.filter((r) => nowPos(r) > 0 && nowPos(r) <= 3).length,
      pageOneAtStart: generic.length ? pageOneStart : null,
      trackedSince,
      rows: generic
        .filter((r) => nowPos(r) > 0 && nowPos(r) <= 30)
        .sort((a, b) => Number(onPageOne(nowPos(b))) - Number(onPageOne(nowPos(a))) || (b.volume || 0) - (a.volume || 0) || nowPos(a) - nowPos(b))
        .slice(0, 10)
        .map((r) => ({ keyword: r.keyword, position: nowPos(r), startPosition: r.series[0].pos || null, volume: r.volume, history: sample(r) })),
    };
  }

  // ── Wins
  const wins: PortalWin[] = [];
  for (const r of generic) {
    const now = nowPos(r), before = posAt(r, last30From);
    const top3 = now > 0 && now <= 3 && (before === 0 || before > 3);
    const page1 = onPageOne(now) && !onPageOne(before);
    if (!top3 && !page1) continue;
    const limit = top3 ? 3 : 10;
    const day = r.series.find((p) => p.date >= last30From && p.pos > 0 && p.pos <= limit)?.date || today;
    wins.push({
      key: `win:rank:${r.keyword}`,
      icon: "rank",
      title: top3 ? `“${r.keyword}” reached #${now} on Google` : `“${r.keyword}” is now on Google's first page (#${now})`,
      detail: [before > 0 ? `Up from #${before} a month ago.` : "It wasn't in Google's top 100 a month ago.", r.volume ? `About ${n(r.volume)} people search this every month.` : ""].filter(Boolean).join(" "),
      day,
    });
  }
  if (leadsMonth && leadsMonth.pct != null && leadsMonth.pct >= 15 && leadsMonth.value >= 3) {
    wins.push({ key: `win:leads:${last30To.slice(0, 7)}`, icon: "leads", title: `Leads from your website are up ${leadsMonth.pct}%`, detail: `${n(leadsMonth.value)} in the last 30 days, compared with the 30 days before.`, day: last30To });
  }

  // Weekly visits (Monday weeks, complete weeks only) for the chart and the record-week win.
  const weekly: PortalReport["weekly"] = [];
  if (ga?.visits) {
    const byWeek = new Map<string, number>();
    for (const r of ga.visits) {
      const d = new Date(`${r.date}T12:00:00Z`);
      const monday = addDays(r.date, -((d.getUTCDay() + 6) % 7));
      byWeek.set(monday, (byWeek.get(monday) || 0) + r.v);
    }
    const thisMonday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
    for (const [week, visits] of [...byWeek].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (week >= weeksFrom && week < thisMonday) weekly.push({ week, visits });
    }
    const last = weekly[weekly.length - 1];
    if (last && weekly.length >= 8 && weekly.slice(0, -1).every((w) => w.visits < last.visits)) {
      wins.push({ key: `win:record:${last.week}`, icon: "record", title: `Your busiest week yet: ${n(last.visits)} visits`, detail: `The week of ${shortDay(last.week)} was the most visits in the last ${weekly.length} weeks.`, day: addDays(last.week, 6) });
    }
  }

  if (ai?.status === "ok") {
    const engineName = new Map(ai.engines.map((e) => [e.id, e.name]));
    const mentioned = ai.prompts.filter((p) => Object.values(p.byEngine).some((r) => (r.mentionPosition || 0) > 0));
    const best = mentioned[0];
    if (best) {
      const engines = Object.entries(best.byEngine).filter(([, r]) => (r.mentionPosition || 0) > 0).map(([id]) => engineName.get(Number(id))).filter(Boolean);
      const dates = Object.values(best.byEngine).map((r) => r.date).filter((d): d is string => !!d).sort();
      wins.push({ key: `win:ai:${best.prompt}`, icon: "ai", title: `${engines[0]} recommends you when people ask “${best.prompt}”`, detail: engines.length > 1 ? `${engines.slice(1).join(" and ")} mention you too.` : "AI assistants are becoming a new way patients find care.", day: dates[dates.length - 1] || today });
    }
  }

  // ── What we did
  const groups = new Map<string, SiteEvent>();
  for (const e of events) {
    if (!CHANGE_KINDS.has(e.kind) || e.day < addDays(startedAt, -30)) continue;
    const k = groupKey(e);
    const prev = groups.get(k);
    // Prefer the publish (when it went live) over the "done" mark.
    if (!prev || (e.kind === "published" && prev.kind !== "published")) groups.set(k, e);
  }
  const recent = [...groups.entries()].sort((a, b) => b[1].occurredAt.localeCompare(a[1].occurredAt)).slice(0, 15);

  const taskKeys = recent.map(([k]) => k).filter((k) => k.startsWith("task:")).map((k) => k.slice(5));
  const whyByTask = new Map<string, string>();
  if (taskKeys.length) {
    const db = await getDb();
    const res = await db.execute({
      sql: `SELECT task_key, task FROM agent_tasks WHERE client_slug = ? AND task_key IN (${taskKeys.map(() => "?").join(",")})`,
      args: [slug, ...taskKeys],
    });
    for (const r of res.rows) {
      try { whyByTask.set(r.task_key as string, (JSON.parse(r.task as string) as { why?: string }).why || ""); } catch { /* skip */ }
    }
  }
  const feedback = await listFeedback(slug).catch(() => []);
  const feedbackById = new Map(feedback.map((f) => [f.id, f]));

  const changes: PortalChange[] = [];
  for (let i = 0; i < recent.length; i += 3) {
    const batch = await Promise.all(recent.slice(i, i + 3).map(async ([k, e]): Promise<PortalChange> => {
      if (k.startsWith("feedback:")) {
        const f = feedbackById.get(Number(k.slice(9)));
        const body = f?.body || e.title.replace(/^Client feedback resolved: /, "").replace(/^“|”$/g, "");
        return { key: `change:${k}`, day: e.day, kind: "request", title: `Your request: “${body.length > 90 ? `${body.slice(0, 88)}…` : body}”`, why: f ? `You asked for this on the ${pageName(f.pagePath)} page${f.device !== "desktop" ? ` (${f.device})` : ""}.` : "You asked for this in a comment on your site.", result: { tone: "good", text: "Done" } };
      }
      const impact = await eventImpact(slug, config, e.id as number).catch(() => null);
      if (e.kind === "page_added") {
        const title = e.pages.length === 1 ? `Added a new page: ${pageName(e.pages[0])}` : `Added ${e.pages.length} new pages to your site`;
        return { key: `change:${k}`, day: e.day, kind: "page", title, why: null, result: resultText(impact) };
      }
      return { key: `change:${k}`, day: e.day, kind: "improvement", title: clientTitle(e.title), why: whyByTask.get(k.slice(5)) || (e.kind === "published" ? null : e.detail) || null, result: resultText(impact) };
    }));
    changes.push(...batch);
  }

  // Impact wins: changes that clearly paid off.
  for (const c of changes) {
    if (c.result?.tone !== "good" || c.kind === "request") continue;
    const m = c.result.text.match(/\+(\d+)%/);
    if (m && Number(m[1]) >= 20) wins.push({ key: `win:impact:${c.key}`, icon: "impact", title: `A change paid off: ${c.result.text.replace(/ since.*$/, "")}`, detail: `After we ${c.title.charAt(0).toLowerCase()}${c.title.slice(1)} on ${shortDay(c.day)}.`, day: c.day });
  }
  for (const e of events) {
    if (e.kind !== "page_added" || e.day < last30From || e.pages.length !== 1) continue;
    wins.push({ key: `win:page:${e.ref}`, icon: "page", title: `Your new ${pageName(e.pages[0])} page is live`, detail: "Google usually starts showing new pages within a few weeks.", day: e.day });
  }
  wins.sort((a, b) => b.day.localeCompare(a.day));

  // ── Their requests (from the review tool)
  const reviewToken = await getReviewLink(slug);
  const cutoff = addDays(today, -90);
  const requests: PortalRequest[] = feedback
    .filter((f) => f.kind === "comment" && !f.isTeam && (f.status !== "resolved" || f.updatedAt.slice(0, 10) >= cutoff))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8)
    .map((f) => ({
      id: f.id,
      status: f.status,
      day: (f.status === "resolved" ? f.updatedAt : f.createdAt).slice(0, 10),
      body: f.body,
      reply: [...f.replies].reverse().find((r) => r.isTeam)?.body || null,
      page: pageName(f.pagePath),
      device: f.device,
      link: `/review/${reviewToken}?c=${f.id}`,
    }));

  // ── AI search
  let aiSummary: PortalReport["ai"] = null;
  if (ai?.status === "ok" && ai.prompts.length) {
    const engineName = new Map(ai.engines.map((e) => [e.id, e.name]));
    const rows = ai.prompts.map((p) => ({
      prompt: p.prompt,
      engines: Object.entries(p.byEngine).filter(([, r]) => (r.mentionPosition || 0) > 0).map(([id]) => engineName.get(Number(id)) || "AI"),
    }));
    const yes = rows.filter((r) => r.engines.length);
    aiSummary = { mentioned: yes.length, total: rows.length, rows: [...yes.slice(0, 5), ...rows.filter((r) => !r.engines.length).slice(0, Math.max(1, 6 - Math.min(5, yes.length)))] };
  }

  // ── Headline sentences
  const done30 = changes.filter((c) => c.day >= last30From).length;
  const monthHeadline =
    leadsMonth?.pct != null && leadsMonth.pct >= 10 ? `Leads from your website are up ${leadsMonth.pct}% this month.`
    : foundMonth?.pct != null && foundMonth.pct >= 10 ? `${foundMonth.pct}% more people found you on Google this month.`
    : pageOneNow > pageOne30 ? `You moved onto Google's first page for ${pageOneNow - pageOne30} more ${pageOneNow - pageOne30 === 1 ? "search" : "searches"} this month.`
    : "Here's how your website did this month.";
  const monthLede = [
    foundMonth ? `${n(foundMonth.value)} ${gsc ? "people found you through Google search" : "visits to your website"} in the last 30 days` : null,
    leadsMonth ? `${n(leadsMonth.value)} ${leadsMonth.value === 1 ? "lead" : "leads"} came in through your site` : null,
    done30 ? `we made ${done30} ${done30 === 1 ? "improvement" : "improvements"}` : null,
  ].filter(Boolean);
  const startHeadline =
    pageOneStart < pageOneNow && rankings ? `Since ${monthLabel(startedAt)}, you've gone from ${pageOneStart} to ${pageOneNow} searches on Google's first page.`
    : foundStart?.pct != null && foundStart.pct >= 10 ? `Since ${monthLabel(startedAt)}, ${foundStart.pct}% more people find you on Google each month.`
    : `Here's everything since we started in ${monthLabel(startedAt)}.`;
  const startLede = [
    foundStart ? `${n(foundStart.value)} ${gsc ? "people have found you through Google" : "visits to your website"}` : null,
    leadsStart ? `${n(leadsStart.value)} ${leadsStart.value === 1 ? "lead" : "leads"} from your site` : null,
    groups.size ? `${groups.size} ${groups.size === 1 ? "change" : "changes"} made to your site` : null,
  ].filter(Boolean);
  const list = (parts: string[]) => (parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`);
  const sentence = (parts: (string | null)[], lead: string) => {
    const items = parts.filter((x): x is string => !!x);
    return items.length ? `${lead}${list(items)}.` : "";
  };

  const periods: PortalPeriod[] = [
    {
      key: "month",
      eyebrow: `Last 30 days · through ${shortDay(last30To)}`,
      headline: monthHeadline,
      lede: sentence(monthLede, "").replace(/^./, (c) => c.toUpperCase()),
      compareLabel: "vs the 30 days before",
      found: foundMonth ? { ...foundMonth, label: foundLabel } : null,
      leads: leadsMonth,
      pageOne: ranks ? { value: pageOneNow, gained: pageOneNow - pageOne30, gainedLabel: "this month" } : null,
      value: null,
      valueNote: null,
    },
    {
      key: "start",
      eyebrow: `Since we started · ${monthLabel(startedAt)} to today`,
      headline: startHeadline,
      lede: sentence(startLede, "So far: "),
      compareLabel: `per month vs your first month`,
      found: foundStart ? { ...foundStart, label: foundLabel } : null,
      leads: leadsStart,
      pageOne: ranks ? { value: pageOneNow, gained: pageOneNow - pageOneStart, gainedLabel: `since ${monthLabel(trackedSince).split(" ")[0]}` } : null,
      value: null,
      valueNote: null,
    },
  ];

  return {
    client: { name: config.name, domain: config.domain, iconUrl: config.iconUrl || null },
    generatedAt: new Date().toISOString(),
    startedAt,
    startedLabel: monthLabel(startedAt),
    periods,
    weekly,
    wins: wins.slice(0, 8),
    changes,
    rankings,
    requests,
    ai: aiSummary,
    reviewPath: `/review/${reviewToken}`,
    sources,
  };
}

export async function cachedReport(slug: string, config: ClientConfig, settings: PortalSettings, fresh = false): Promise<PortalReport> {
  const db = await getDb();
  const key = `${CACHE_VERSION}:${settings.startedAt || ""}`;
  if (!fresh) {
    const cached = await db.execute({
      sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'portal_report' AND date_range = ? AND fetched_at > datetime('now', ?)`,
      args: [slug, key, `-${CACHE_HOURS} hours`],
    });
    if (cached.rows[0]) return JSON.parse(cached.rows[0].data as string);
  }
  const report = await buildReport(slug, config, settings);
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at) VALUES (?, 'portal_report', ?, ?, datetime('now'))`,
    args: [slug, key, JSON.stringify(report)],
  });
  return report;
}

// The team's edits on top of the built report. With `forClient`, hidden items
// and the source diagnostics are removed; otherwise they're flagged.
export function applySettings(report: PortalReport, settings: PortalSettings, forClient: boolean): PortalReport {
  const hidden = new Set(settings.hidden);
  const edit = <T extends { key: string; title: string }>(item: T) => {
    const o = settings.overrides[item.key];
    return { ...item, ...(o?.title ? { title: o.title } : {}), ...("why" in item && o?.why ? { why: o.why } : {}), hidden: hidden.has(item.key), edited: !!o };
  };
  const wins = report.wins.map(edit).filter((w) => !forClient || !w.hidden);
  const changes = report.changes.map(edit).filter((c) => !forClient || !c.hidden);
  const periods = report.periods.map((p) => {
    if (!settings.leadValue || !p.leads) return p;
    return {
      ...p,
      value: p.leads.value * settings.leadValue,
      valueNote: `in potential revenue from new leads ${p.key === "month" ? "in the last 30 days" : "since we started"}, based on a $${n(settings.leadValue)} average value per lead`,
    };
  });
  return { ...report, wins, changes, periods, sources: forClient ? [] : report.sources };
}
