// Saving the Keyword Map plan and sending a page's recommendations to Agents.
//
// The plan is the client's core set (which page targets which keyword), plus
// two things the canvas adds: terms taken off every page ("parked", so they
// aren't lost) and the team's edits to each page's recommendations. Every save
// keeps the previous core set in history and, when assignments changed, puts a
// marker on the change timeline that every chart reads.

import { getDb } from "./db";
import { getCoreSet, planVersion, MAX_TERMS_PER_PAGE, type CoreSet, type CoreTerm, type ParkedTerm, type Priority } from "./keyword-map";
import type { RecEdits } from "./keyword-plan";
import { recordEvent } from "./site-events";
import { upsertManualTask, type AgentTask, type TaskStatus } from "./agent-tasks";
import { normalizePath } from "./page-behavior";
import type { ClientConfig } from "./clients";

export class PlanError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const PRIORITIES = new Set<Priority>(["P1", "P2", "P3"]);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const isPath = (k: string) => k.startsWith("/");

function cleanRecs(raw: unknown): Record<string, RecEdits> {
  const out: Record<string, RecEdits> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [page, v] of Object.entries(raw as Record<string, Partial<RecEdits>>).slice(0, 500)) {
    const edits = Object.fromEntries(Object.entries(v?.edits || {}).filter(([, t]) => typeof t === "string" && t.trim()).map(([k, t]) => [k, (t as string).trim().slice(0, 600)]));
    const dismissed = (v?.dismissed || []).filter((k): k is string => typeof k === "string").slice(0, 100);
    const custom = (v?.custom || []).filter((c) => c && typeof c.text === "string" && c.text.trim()).slice(0, 30).map((c) => ({ id: String(c.id).slice(0, 40), text: c.text.trim().slice(0, 600) }));
    if (Object.keys(edits).length || dismissed.length || custom.length) out[page] = { edits, dismissed, custom };
  }
  return out;
}

export interface SaveInput {
  version: string | null;
  terms: CoreTerm[];
  parked: ParkedTerm[];
  recs: unknown;
}

export async function savePlan(slug: string, input: SaveInput) {
  const core = await getCoreSet(slug);
  if (!core) throw new PlanError("This client has no core keyword set yet.", 404);
  if ((input.version ?? null) !== planVersion(core)) {
    throw new PlanError("Someone saved the keyword plan since you opened it. Reload to see their changes, then make yours again.", 409);
  }

  // Planned pages can be targeted but not invented here.
  const plannedKeys = new Set(core.terms.map((t) => t.page).filter((p) => !isPath(p)));
  const seen = new Set<string>();
  const terms: CoreTerm[] = [];
  for (const t of input.terms || []) {
    const keyword = String(t?.keyword || "").trim().slice(0, 200);
    if (!keyword || seen.has(norm(keyword))) continue;
    const page = isPath(String(t.page || "")) ? normalizePath(String(t.page)) : String(t.page || "");
    if (!isPath(page) && !plannedKeys.has(page)) throw new PlanError(`"${keyword}" points at a page that doesn't exist: ${page || "(none)"}.`);
    if (!PRIORITIES.has(t.priority)) throw new PlanError(`"${keyword}" needs a priority of P1, P2 or P3.`);
    seen.add(norm(keyword));
    terms.push({ keyword, page, priority: t.priority, primary: !!t.primary });
  }
  const parked = (input.parked || [])
    .filter((p) => p && typeof p.keyword === "string" && p.keyword.trim() && !seen.has(norm(p.keyword)))
    .map((p) => ({ keyword: p.keyword.trim().slice(0, 200), priority: PRIORITIES.has(p.priority) ? p.priority : "P3" as Priority }))
    .slice(0, 300);

  // At most MAX_TERMS_PER_PAGE per page. A page already over the limit can be
  // saved as long as it doesn't grow, so old data never blocks a save.
  const count = (list: CoreTerm[]) => list.reduce((m, t) => m.set(t.page, (m.get(t.page) || 0) + 1), new Map<string, number>());
  const before = count(core.terms.map((t) => ({ ...t, page: isPath(t.page) ? normalizePath(t.page) : t.page })));
  for (const [page, n] of count(terms)) {
    if (n > MAX_TERMS_PER_PAGE && n > (before.get(page) || 0)) throw new PlanError(`${page} would target ${n} terms. The limit is ${MAX_TERMS_PER_PAGE} per page.`);
  }
  // One primary per page: the first one marked wins.
  const hasPrimary = new Set<string>();
  for (const t of terms) {
    if (t.primary && hasPrimary.has(t.page)) t.primary = false;
    else if (t.primary) hasPrimary.add(t.page);
  }

  const now = new Date().toISOString();
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
          VALUES (?, 'core_keywords_history', ?, ?, datetime('now'))`,
    args: [slug, now, JSON.stringify(core)],
  });
  const next: CoreSet = { ...core, updatedAt: now, terms };
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
          VALUES (?, 'core_keywords', 'current', ?, datetime('now'))`,
    args: [slug, JSON.stringify(next)],
  });
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
          VALUES (?, 'keyword_plan', 'current', ?, datetime('now'))`,
    args: [slug, JSON.stringify({ parked, recs: cleanRecs(input.recs) })],
  });

  const changes = describeChanges(core.terms, terms);
  if (changes.lines.length) {
    await recordEvent(slug, {
      kind: "keyword_plan",
      title: `Keyword targets updated: ${changes.summary}`,
      detail: changes.lines.slice(0, 15).join("\n") + (changes.lines.length > 15 ? `\n…and ${changes.lines.length - 15} more` : ""),
      pages: changes.pages,
      source: "Keyword Map",
      ref: `kwplan:${now}`,
      occurredAt: now,
    });
  }
  return { version: now, changes: changes.lines.length };
}

function describeChanges(before: CoreTerm[], after: CoreTerm[]) {
  const key = (p: string) => (isPath(p) ? normalizePath(p) : p);
  const was = new Map(before.map((t) => [norm(t.keyword), { ...t, page: key(t.page) }]));
  const now = new Map(after.map((t) => [norm(t.keyword), t]));
  const lines: string[] = [];
  const pages = new Set<string>();
  let moved = 0, added = 0, removed = 0;
  for (const [k, t] of now) {
    const old = was.get(k);
    if (!old) { added++; lines.push(`“${t.keyword}”: added to ${t.page}`); pages.add(t.page); }
    else if (old.page !== t.page) { moved++; lines.push(`“${t.keyword}”: ${old.page} → ${t.page}`); pages.add(old.page); pages.add(t.page); }
  }
  for (const [k, t] of was) {
    if (!now.has(k)) { removed++; lines.push(`“${t.keyword}”: taken off ${t.page}`); pages.add(t.page); }
  }
  const parts = [moved && `${moved} moved`, added && `${added} added`, removed && `${removed} taken off a page`].filter(Boolean);
  return { lines, summary: parts.join(", "), pages: [...pages].filter(isPath) };
}

// ── Push to Agents ──────────────────────────────────────────────────────────

export async function pushToAgents(
  slug: string,
  config: ClientConfig,
  input: { page: string; recommendations: string[]; positions?: Record<string, number | null> },
): Promise<{ key: string; status: TaskStatus; title: string }> {
  const core = await getCoreSet(slug);
  if (!core) throw new PlanError("This client has no core keyword set yet.", 404);
  const pageKey = isPath(input.page) ? normalizePath(input.page) : input.page;
  const terms = core.terms.filter((t) => (isPath(t.page) ? normalizePath(t.page) : t.page) === pageKey);
  if (!terms.length) throw new PlanError("This page has no saved target terms. Save the plan first, then send it to Agents.");
  const recommendations = (input.recommendations || []).filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim().slice(0, 600)).slice(0, 30);
  if (!recommendations.length) throw new PlanError("There are no recommendations to send for this page.");

  const order: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };
  const sorted = [...terms].sort((a, b) => Number(b.primary) - Number(a.primary) || order[a.priority] - order[b.priority]);
  const primary = sorted[0];
  const planned = !isPath(pageKey);
  const label = pageKey.replace(/^Needs page:\s*/i, "").replace(/\s*\(confirm\)\s*$/i, "");
  const origin = `https://${config.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const best = sorted.reduce<Priority>((b, t) => (order[t.priority] < order[b] ? t.priority : b), "P3");
  const pos = (k: string) => input.positions?.[k] ?? null;

  const title = planned ? `Create the page for “${primary.keyword}”` : `Rank ${pageKey} for “${primary.keyword}”`;
  const task: AgentTask = {
    key: `kwmap:${pageKey}`,
    type: "keyword_target",
    category: "search",
    title,
    why: `${planned ? `A planned page (${label})` : "This page"} targets ${sorted.map((t) => `“${t.keyword}”`).join(", ")} in the Keyword Map. These are the changes it needs to rank.`,
    evidence: recommendations,
    impact: best === "P1" ? "high" : best === "P2" ? "medium" : "low",
    score: (3 - order[best]) * 10 + recommendations.length,
    ...(planned ? {} : { path: pageKey, url: origin + (pageKey === "/" ? "/" : pageKey) }),
    keywords: sorted.map((t) => t.keyword),
    data: { planned, label, terms: sorted.map((t) => ({ keyword: t.keyword, priority: t.priority, primary: t === primary, position: pos(t.keyword) })) },
  };
  const status = await upsertManualTask(slug, task);
  const now = new Date().toISOString();
  await recordEvent(slug, {
    kind: "agent_queued",
    title: `Sent to Agents: ${title}`,
    detail: recommendations.slice(0, 8).map((r) => `- ${r}`).join("\n"),
    pages: planned ? [] : [pageKey],
    source: "Keyword Map",
    ref: `kwpush:${pageKey}:${now}`,
    occurredAt: now,
  });
  return { key: task.key, status, title };
}

