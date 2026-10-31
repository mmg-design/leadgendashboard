// Link building prospects: sites worth a link for each client, and the
// client's link profile they're picked from. The research (reading the site,
// searching the web, drafting pitches) runs in Claude Code on the team's
// Claude plan, through scripts/link-prospects.ts, so it costs no API credits.
// The dashboard only ranks, stages and shows what's stored here.

import { getDb } from "./db";
import { domainAuthority } from "./backlinks";
import type { AgentTask, Impact, TaskStatus } from "./agent-tasks";
import { EFFORT_LABEL, KIND_LABEL, PROFILE_FIELDS, STAGE_LABEL, type Effort, type LinkProfile, type ProspectKind, type Stage } from "./link-prospect-labels";

export * from "./link-prospect-labels";

// What Claude researches for each prospect.
export interface ProspectInput {
  domain: string;
  name: string; // the organisation, e.g. "Westerville Area Chamber of Commerce"
  kind: ProspectKind;
  effort: Effort; // easy: a form or listing; medium: an email pitch; hard: an editorial piece
  fit: 1 | 2 | 3; // how closely the site matches the client's customers and area
  why: string; // one or two sentences, specific to this client
  targetPage: string; // the client page the link should point to
  nextStepUrl: string; // where the next step happens: the form, partner page or contact page
  nextStepLabel: string; // e.g. "Submit a listing", "Email the editor"
  contact: string; // a public name, role or address, or ""
  pitchSubject: string;
  pitchBody: string;
  followUp: string;
}

export interface LinkProspect extends ProspectInput {
  id: number;
  authority: number;
  nextStepStatus: number | null; // HTTP status when the link was checked; null if it didn't load
  researchedAt: string;
  stage: Stage;
  notes: string;
  stageChangedAt: string;
  priority: number;
  followUpDue: boolean; // in progress for a week with no change
}

const FOLLOW_UP_DAYS = 7;
export const SHOWN_NOT_STARTED = 5; // the list always shows at least this many to start
export const BACKLOG_TARGET = 15; // research tops the list back up to this many not started

export const rootDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");

const EFFORT_SCORE: Record<Effort, number> = { easy: 3, medium: 2, hard: 1 };
// Easiest first; among equally easy ones, the closest fit, then the strongest site.
export const priorityOf = (p: Pick<LinkProspect, "effort" | "fit" | "authority">) => EFFORT_SCORE[p.effort] * 1000 + p.fit * 100 + Math.min(99, p.authority);

const utc = (s: string) => new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);

function rowToProspect(row: Record<string, unknown>): LinkProspect {
  const data = JSON.parse(row.data as string) as Omit<LinkProspect, "id" | "stage" | "notes" | "stageChangedAt" | "priority" | "followUpDue">;
  const stage = row.stage as Stage;
  const stageChangedAt = row.stage_changed_at as string;
  return {
    ...data,
    id: Number(row.id),
    stage,
    notes: (row.notes as string) || "",
    stageChangedAt,
    priority: priorityOf(data),
    followUpDue: stage === "in_progress" && Date.now() - utc(stageChangedAt).getTime() > FOLLOW_UP_DAYS * 86_400_000,
  };
}

export async function listProspects(slug: string): Promise<LinkProspect[]> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM link_prospects WHERE client_slug = ?", args: [slug] });
  return res.rows.map((r) => rowToProspect(r as Record<string, unknown>)).sort((a, b) => b.priority - a.priority);
}

// What the Links tab and Agents show: everything being worked on, plus the
// top not-started prospects. The rest wait in the backlog.
export function shownProspects(all: LinkProspect[]) {
  const working = all.filter((p) => p.stage === "in_progress" || p.stage === "follow_up");
  const next = all.filter((p) => p.stage === "not_started");
  return { working, next: next.slice(0, SHOWN_NOT_STARTED), backlog: next.slice(SHOWN_NOT_STARTED) };
}

export async function setStage(slug: string, id: number, patch: { stage?: Stage; notes?: string }) {
  const db = await getDb();
  const sets = ["updated_at = datetime('now')"];
  const args: (string | number)[] = [];
  if (patch.stage) { sets.push("stage = ?", "stage_changed_at = datetime('now')"); args.push(patch.stage); }
  if (patch.notes !== undefined) { sets.push("notes = ?"); args.push(patch.notes.slice(0, 2000)); }
  await db.execute({ sql: `UPDATE link_prospects SET ${sets.join(", ")} WHERE client_slug = ? AND id = ?`, args: [...args, slug, id] });
  await syncProspectTasks(slug);
}

async function checkUrl(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
    });
    return res.status;
  } catch {
    return null;
  }
}

const KINDS = Object.keys(KIND_LABEL) as ProspectKind[];

// Adds researched prospects. A domain already on the list (in any stage,
// dismissed included), the client's own domain, and sites that already link
// to the client are skipped. Each next-step link is checked, and authority
// comes from SE Ranking (one cheap lookup per new domain).
export async function addProspects(slug: string, clientDomain: string, items: ProspectInput[], alreadyLinking: string[] = []) {
  const db = await getDb();
  const existing = new Set((await listProspects(slug)).map((p) => p.domain));
  const linking = new Set(alreadyLinking.map(rootDomain));
  const own = rootDomain(clientDomain);
  const added: string[] = [];
  const skipped: { domain: string; reason: string }[] = [];

  for (const item of items) {
    const domain = rootDomain(item.domain || "");
    const problem =
      !domain || !domain.includes(".") ? "no domain"
      : domain === own || domain.endsWith(`.${own}`) ? "the client's own site"
      : existing.has(domain) ? "already on the list"
      : linking.has(domain) ? "already links to the client"
      : !KINDS.includes(item.kind) ? `unknown kind "${item.kind}"`
      : !(item.effort in EFFORT_SCORE) ? `unknown effort "${item.effort}"`
      : !/^https?:\/\//.test(item.nextStepUrl || "") ? "no next-step link"
      : !item.why?.trim() ? "no reason given"
      : null;
    if (problem) { skipped.push({ domain: domain || item.domain, reason: problem }); continue; }

    const [nextStepStatus, authority] = await Promise.all([
      checkUrl(item.nextStepUrl),
      domainAuthority(domain).catch(() => 0),
    ]);
    if (nextStepStatus === 404 || nextStepStatus === 410) { skipped.push({ domain, reason: `next-step link returns ${nextStepStatus}` }); continue; }

    const data = {
      domain,
      name: item.name?.trim() || domain,
      kind: item.kind,
      effort: item.effort,
      fit: Math.min(3, Math.max(1, Math.round(Number(item.fit) || 2))) as 1 | 2 | 3,
      why: item.why.trim(),
      targetPage: item.targetPage?.trim() || "/",
      nextStepUrl: item.nextStepUrl,
      nextStepLabel: item.nextStepLabel?.trim() || "Open",
      contact: item.contact?.trim() || "",
      pitchSubject: item.pitchSubject?.trim() || "",
      pitchBody: item.pitchBody?.trim() || "",
      followUp: item.followUp?.trim() || "",
      authority,
      nextStepStatus,
      researchedAt: new Date().toISOString(),
    };
    await db.execute({ sql: "INSERT INTO link_prospects (client_slug, domain, data) VALUES (?, ?, ?)", args: [slug, domain, JSON.stringify(data)] });
    existing.add(domain);
    added.push(domain);
  }
  await syncProspectTasks(slug);
  return { added, skipped };
}

// ── Link profile ────────────────────────────────────────────────────────────

export async function getProfile(slug: string): Promise<LinkProfile | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT data, updated_by, updated_at FROM link_profiles WHERE client_slug = ?", args: [slug] });
  const row = res.rows[0];
  return row ? { ...(JSON.parse(row.data as string)), updatedBy: row.updated_by as LinkProfile["updatedBy"], updatedAt: row.updated_at as string } : null;
}

// Claude's draft never replaces a profile the team has edited.
export async function saveProfile(slug: string, profile: Partial<LinkProfile>, by: LinkProfile["updatedBy"]) {
  const current = await getProfile(slug);
  // An empty profile saved from the form doesn't count as the team's version.
  const teamWrote = current?.updatedBy === "Team" && PROFILE_FIELDS.some(({ key }) => current[key]?.trim());
  if (by === "Claude" && teamWrote) return { saved: false as const, reason: "The team has edited this profile, so Claude's draft wasn't saved." };
  const data = Object.fromEntries(PROFILE_FIELDS.map(({ key }) => [key, String(profile[key] ?? current?.[key] ?? "").slice(0, 3000)]));
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO link_profiles (client_slug, data, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(client_slug) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    args: [slug, JSON.stringify(data), by],
  });
  return { saved: true as const };
}

// ── Agents ──────────────────────────────────────────────────────────────────

export const prospectTaskKey = (domain: string) => `link_prospect:${domain}`;
export const prospectDomainFromKey = (key: string) => (key.startsWith("link_prospect:") ? key.slice(14) : null);

const TASK_STATUS: Record<Stage, TaskStatus> = {
  not_started: "drafted", in_progress: "drafted", follow_up: "drafted", completed: "done", dismissed: "dismissed",
};

function impactOf(p: LinkProspect): Impact {
  if (p.fit === 3 && p.authority >= 30) return "high";
  return p.fit >= 2 ? "medium" : "low";
}

function toTask(p: LinkProspect): AgentTask {
  return {
    key: prospectTaskKey(p.domain),
    type: "link_prospect",
    category: "links",
    title: `Get a link from ${p.name}`,
    why: p.why,
    evidence: [
      `${EFFORT_LABEL[p.effort]} · ${KIND_LABEL[p.kind]} · authority ${p.authority}`,
      `Next step: ${p.nextStepLabel}`,
      `Link to: ${p.targetPage}`,
      ...(p.contact ? [`Contact: ${p.contact}`] : []),
      `Stage: ${STAGE_LABEL[p.stage]}${p.followUpDue ? " (a week with no change, time to follow up)" : ""}`,
      ...(p.notes ? [`Notes: ${p.notes}`] : []),
    ],
    impact: impactOf(p),
    score: p.priority,
    url: p.nextStepUrl,
    domain: p.domain,
    data: { prospectId: p.id, nextStepLabel: p.nextStepLabel, stage: p.stage },
  };
}

// Mirrors the shown prospects into the Agents queue (Links category) with the
// pitch already written, so Agents never has to call Claude for them. Backlog
// prospects leave the queue until they move up.
export async function syncProspectTasks(slug: string) {
  const db = await getDb();
  const all = await listProspects(slug);
  const { working, next } = shownProspects(all);
  const closed = all.filter((p) => p.stage === "completed" || p.stage === "dismissed");
  const mirrored = [...working, ...next, ...closed];
  const keep = new Set(mirrored.map((p) => prospectTaskKey(p.domain)));

  for (const p of mirrored) {
    const output = {
      summary: "",
      outreach: p.pitchBody ? [{ target: `${p.name}${p.contact ? `, ${p.contact}` : ""}`, approach: `${p.nextStepLabel}: ${p.nextStepUrl}`, pitchSubject: p.pitchSubject, pitchBody: p.pitchBody, followUp: p.followUp }] : [],
      steps: [],
      model: "Claude Code research",
      generatedAt: p.researchedAt,
    };
    await db.execute({
      sql: `INSERT INTO agent_tasks (client_slug, task_key, task, status, output) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(client_slug, task_key) DO UPDATE SET task = excluded.task, status = excluded.status, output = excluded.output`,
      args: [slug, prospectTaskKey(p.domain), JSON.stringify(toTask(p)), TASK_STATUS[p.stage], JSON.stringify(output)],
    });
  }
  const rows = await db.execute({ sql: "SELECT task_key FROM agent_tasks WHERE client_slug = ? AND task_key LIKE 'link_prospect:%'", args: [slug] });
  for (const r of rows.rows) {
    const key = r.task_key as string;
    if (!keep.has(key)) await db.execute({ sql: "DELETE FROM agent_tasks WHERE client_slug = ? AND task_key = ?", args: [slug, key] });
  }
  // Prospects replace the old competitor-gap tasks; ones nobody touched go.
  if (all.length) {
    await db.execute({ sql: "DELETE FROM agent_tasks WHERE client_slug = ? AND task_key LIKE 'link_gap:%' AND status IN ('open', 'resolved')", args: [slug] });
  }
}

// Agents' Done / Dismiss / Reopen buttons move the prospect too.
export async function stageFromTask(slug: string, key: string, status: TaskStatus) {
  const domain = prospectDomainFromKey(key);
  if (!domain) return;
  const p = (await listProspects(slug)).find((x) => x.domain === domain);
  if (!p) return;
  const stage: Stage | null = status === "done" ? "completed" : status === "dismissed" ? "dismissed" : status === "open" || status === "drafted" ? "not_started" : null;
  if (stage && stage !== p.stage) await setStage(slug, p.id, { stage });
}
