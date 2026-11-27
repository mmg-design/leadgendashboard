import { getDb } from "./db";
import { getClient, type ClientConfig } from "./clients";
import { getTask, type StoredTask } from "./agent-tasks";
import type { AgentOutput } from "./agent-runner";
import { addComment, getWorkTask, listComments, updateWorkTask, type WorkComment, type WorkTask } from "./work-tasks";
import { notifyAgentResult } from "./work-access";
import { GitHubApiError, GitHubAppError, ghApi } from "./github-app";

// Agents that carry a Work task out in the client's code. The dashboard starts
// the "MMG agent" workflow in the client's GitHub repo with a brief; the
// workflow has Claude Code make the change on mmg-agent/task-<id>, checks the
// site builds, pushes, waits for the preview build and pings us back. We then
// open (or update) the pull request, find the preview link, move the task to
// review and email the owner. Nothing is merged or published here: that stays
// a person's call. "Send back" starts another round on the same branch and PR.

const WORKFLOW = "mmg-agent.yml";
const AGENT = { id: null, name: "MMG agent" };
const ACTIVE = ["queued", "running", "finishing"] as const;

export type RunStatus = "queued" | "running" | "finishing" | "done" | "no_changes" | "failed";

export interface AgentRun {
  id: number;
  workTaskId: number;
  clientSlug: string;
  repo: string;
  branch: string;
  round: number;
  status: RunStatus;
  feedback: string | null;
  ghRunUrl: string | null;
  changedFiles: number | null;
  prUrl: string | null;
  previewUrl: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export class RunError extends Error {}

export const isActive = (s: RunStatus) => (ACTIVE as readonly string[]).includes(s);

// The client's repo, if agents can work in its code.
export function githubFor(config: ClientConfig | null | undefined) {
  const gh = config?.integrations.github;
  const platform = config?.integrations.site?.platform;
  if (platform && platform !== "github") return null;
  if (!gh?.enabled || !/^[\w.-]+\/[\w.-]+$/.test(gh.repo || "")) return null;
  return { repo: gh.repo, base: gh.baseBranch || "main", previewUrl: gh.previewUrl || "" };
}

// What the UI should offer: "github" (ready), "needs_token" (repo set, GitHub
// not connected) or null. `access` is hasGitHubAccess(), looked up once per request.
export function executorFor(config: ClientConfig | null | undefined, access: boolean): "github" | "needs_token" | null {
  if (!githubFor(config)) return null;
  return access ? "github" : "needs_token";
}

// ── GitHub ──────────────────────────────────────────────────────────────────

// GitHub calls go through the shared helper; a missing connection reads as a RunError.
async function gh<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  try {
    return await ghApi<T>(path, init);
  } catch (err) {
    if (err instanceof GitHubAppError) throw new RunError(err.message);
    throw err;
  }
}

interface GhRun { id: number; html_url: string; display_title: string; status: string; conclusion: string | null }
interface GhCommit { sha: string; commit: { message: string }; files?: unknown[] }
interface GhPull { number: number; html_url: string }

// The preview for a commit: a deployment status (Vercel and similar), a URL in a
// check run, or a Cloudflare version ID turned into its address.
async function findPreview(repo: string, sha: string, template: string): Promise<string | null> {
  const deployments = await gh<{ id: number; environment: string }[]>(`/repos/${repo}/deployments?sha=${sha}&per_page=10`).catch(() => []);
  for (const d of deployments) {
    if (/production/i.test(d.environment)) continue;
    const statuses = await gh<{ state: string; environment_url?: string; target_url?: string }[]>(`/repos/${repo}/deployments/${d.id}/statuses?per_page=5`).catch(() => []);
    const ok = statuses.find((s) => s.state === "success" && (s.environment_url || s.target_url));
    if (ok) return ok.environment_url || ok.target_url || null;
  }
  // The MMG agent workflow passes Cloudflare's details on as a commit status
  // (tokens like ours can read statuses but not check runs).
  const statuses = await gh<{ context: string; description?: string | null; target_url?: string | null }[]>(`/repos/${repo}/commits/${sha}/statuses?per_page=30`).catch(() => []);
  const mmg = statuses.find((s) => s.context === "MMG preview");
  if (mmg?.target_url && /^https:\/\//.test(mmg.target_url)) return mmg.target_url;
  const checks = await gh<{ check_runs: { output?: { summary?: string | null } }[] }>(`/repos/${repo}/commits/${sha}/check-runs?per_page=30`).catch(() => ({ check_runs: [] }));
  const texts = [mmg?.description || "", ...checks.check_runs.map((c) => c.output?.summary || "")];
  for (const text of texts) {
    const url = text.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.(?:workers|pages)\.dev[^\s)\]'"<]*/i);
    if (url) return url[0];
    const version = text.match(/(?:Version ID:|Cloudflare version)\s*([0-9a-f]{8})/i);
    if (version && template.includes("{version}")) return template.replace("{version}", version[1].toLowerCase());
  }
  return null;
}

// ── Storage ─────────────────────────────────────────────────────────────────

function rowToRun(r: Record<string, unknown>): AgentRun {
  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  return {
    id: Number(r.id), workTaskId: Number(r.work_task_id), clientSlug: r.client_slug as string, repo: r.repo as string,
    branch: r.branch as string, round: Number(r.round), status: r.status as RunStatus, feedback: s("feedback"),
    ghRunUrl: s("gh_run_url"), changedFiles: r.changed_files == null ? null : Number(r.changed_files),
    prUrl: s("pr_url"), previewUrl: s("preview_url"), summary: s("summary"), error: s("error"),
    createdAt: r.created_at as string, finishedAt: s("finished_at"),
  };
}

async function getRunRow(id: number) {
  const db = await getDb();
  return (await db.execute({ sql: "SELECT * FROM agent_runs WHERE id = ?", args: [id] })).rows[0] as Record<string, unknown> | undefined;
}

async function setRun(id: number, fields: Record<string, string | number | null>) {
  const keys = Object.keys(fields);
  const db = await getDb();
  await db.execute({
    sql: `UPDATE agent_runs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
    args: [...keys.map((k) => fields[k]), id],
  });
}

export async function getRun(id: number): Promise<AgentRun | null> {
  const row = await getRunRow(id);
  return row ? rowToRun(row) : null;
}

export async function listRuns(workTaskId: number): Promise<AgentRun[]> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM agent_runs WHERE work_task_id = ? ORDER BY id", args: [workTaskId] });
  return res.rows.map((r) => rowToRun(r as Record<string, unknown>));
}

// The latest run for each Work task, for boards and the queue.
export async function latestRuns(): Promise<Map<number, AgentRun>> {
  const db = await getDb();
  const res = await db.execute("SELECT * FROM agent_runs WHERE id IN (SELECT MAX(id) FROM agent_runs GROUP BY work_task_id)");
  return new Map(res.rows.map((r) => { const run = rowToRun(r as Record<string, unknown>); return [run.workTaskId, run]; }));
}

// ── The brief ───────────────────────────────────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function buildBrief(work: WorkTask, config: ClientConfig, card: StoredTask | null, comments: WorkComment[], feedback: string | null): string {
  const parts: string[] = [`Task: ${work.title}`, `Client: ${config.name} (${config.domain})`];
  const page = work.pagePath || card?.path;
  if (page) parts.push(`Page: ${page}${card?.url ? ` (${card.url})` : ""}`);
  if (feedback) parts.push(`## Do this now: feedback on your last attempt\n${feedback}\n\nYou're on the same branch as the last attempt, so its changes are already here. Change what the feedback asks for.`);
  if (work.notes) parts.push(`## What to do\n${work.notes}`);
  if (card) {
    // Tasks made from a card already carry its reasoning in their notes.
    const lines = work.notes?.includes(card.why) ? [] : [card.why, ...card.evidence.map((e) => `- ${e}`)];
    if (card.keywords?.length) lines.push(`Keywords: ${card.keywords.join(", ")}`);
    if (lines.length) parts.push(`## Why (from the dashboard's analysis)\n${lines.join("\n")}`);
    const ctx = card.data?.ownerContext;
    if (typeof ctx === "string" && ctx.trim()) parts.push(`## Extra context from MMG\n${ctx.trim()}`);
    const out = card.output as Partial<AgentOutput> | null;
    if (out?.summary) {
      const d: string[] = [out.summary];
      if (out.seo) d.push(`SEO title: ${out.seo.title}\nMeta description: ${out.seo.metaDescription}\nH1: ${out.seo.h1}`);
      if (out.proposedChange) d.push(out.proposedChange);
      if (out.sections?.length) d.push(out.sections.map((s) => `### ${s.heading}\n${s.body}`).join("\n\n"));
      if (out.faq?.length) d.push(`FAQ:\n${out.faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n")}`);
      if (out.newPage?.bodyHtml) d.push(`New page body (HTML):\n${clip(out.newPage.bodyHtml, 8000)}`);
      if (out.steps?.length) d.push(out.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`).join("\n"));
      parts.push(`## An earlier draft from the dashboard's agent (a starting point: check it against the site)\n${clip(d.join("\n\n"), 14000)}`);
    }
  }
  const talk = comments.filter((c) => c.authorName !== AGENT.name).slice(-15);
  if (talk.length) parts.push(`## Comments on the task\n${talk.map((c) => `${c.authorName}: ${clip(c.body, 800)}`).join("\n")}`);
  return clip(parts.join("\n\n"), 30000);
}

// ── Starting a run ──────────────────────────────────────────────────────────

export async function startRun(opts: { workTaskId: number; feedback?: string | null; by: { id: number | null; name: string }; origin: string }): Promise<AgentRun> {
  const work = await getWorkTask(opts.workTaskId);
  if (!work) throw new RunError("Task not found.");
  if (!work.clientSlug) throw new RunError("Pick a client first: agents work on a client's site.");
  const config = await getClient(work.clientSlug);
  const exec = githubFor(config);
  if (!config || !exec) throw new RunError("This client's code isn't connected. Add its GitHub repo in the client's settings.");

  const runs = await listRuns(work.id);
  if (runs.some((r) => isActive(r.status))) throw new RunError("The agent is already working on this task.");
  const feedback = opts.feedback?.trim() ? opts.feedback.trim().slice(0, 4000) : null;
  const [card, comments] = await Promise.all([work.agentTaskKey ? getTask(work.clientSlug, work.agentTaskKey) : null, listComments(work.id)]);
  const branch = `mmg-agent/task-${work.id}`;
  const brief = buildBrief(work, config, card, comments, feedback);

  const db = await getDb();
  const ins = await db.execute({
    sql: "INSERT INTO agent_runs (work_task_id, client_slug, repo, branch, round, feedback, origin, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [work.id, work.clientSlug, exec.repo, branch, runs.length + 1, feedback, opts.origin, opts.by.id],
  });
  const id = Number(ins.lastInsertRowid);
  // GitHub can't call a laptop back, so local runs are picked up by polling.
  const callback = /^https:\/\//.test(opts.origin) ? `${opts.origin}/api/agent-runs/callback` : "";
  try {
    await gh(`/repos/${exec.repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: { ref: exec.base, inputs: { run_id: String(id), branch, title: clip(work.title, 120), brief, callback } },
    });
  } catch (err) {
    const message = err instanceof GitHubApiError && err.status === 404
      ? `Couldn't start the agent in ${exec.repo}. Check the repo has the MMG agent workflow and the token can reach it.`
      : err instanceof Error ? err.message : "Couldn't start the agent.";
    await setRun(id, { status: "failed", error: message, finished_at: new Date().toISOString() });
    throw new RunError(message);
  }
  if (work.status !== "in_progress") await updateWorkTask(work.id, { status: "in_progress" });
  return (await getRun(id))!;
}

// ── Following a run ─────────────────────────────────────────────────────────

const minutesSince = (iso: string) => (Date.now() - Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`)) / 60_000;

// Checks one run against GitHub and finishes it once the workflow is done.
// Safe to call often and from several places at once.
export async function syncRun(id: number): Promise<AgentRun | null> {
  const row = await getRunRow(id);
  if (!row) return null;
  let run = rowToRun(row);
  if (run.status !== "queued" && run.status !== "running") return run;
  let ghRunId = row.gh_run_id == null ? null : Number(row.gh_run_id);

  if (!ghRunId) {
    const list = await gh<{ workflow_runs: GhRun[] }>(`/repos/${run.repo}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`);
    const found = list.workflow_runs.find((r) => r.display_title === `MMG agent run ${run.id}`);
    if (!found) {
      if (minutesSince(run.createdAt) > 20) return finish(run, row, { status: "failed", error: "GitHub never started the run." });
      return run;
    }
    ghRunId = found.id;
    await setRun(id, { gh_run_id: found.id, gh_run_url: found.html_url, status: "running" });
    run = { ...run, status: "running", ghRunUrl: found.html_url };
  }

  const ghRun = await gh<GhRun>(`/repos/${run.repo}/actions/runs/${ghRunId}`);
  if (ghRun.status !== "completed") return run;

  // Only one caller gets to finish it.
  const db = await getDb();
  const claim = await db.execute({ sql: "UPDATE agent_runs SET status = 'finishing', updated_at = datetime('now') WHERE id = ? AND status IN ('queued', 'running')", args: [id] });
  if (!claim.rowsAffected) return getRun(id);

  try {
    if (ghRun.conclusion !== "success") {
      return await finish(run, row, { status: "failed", error: ghRun.conclusion === "cancelled" ? "The run was cancelled." : "The agent couldn't finish. The run log on GitHub says why." });
    }
    const config = await getClient(run.clientSlug);
    const exec = githubFor(config);
    const commit = await gh<GhCommit>(`/repos/${run.repo}/commits/${encodeURIComponent(run.branch)}`).catch(() => null);
    const message = commit?.commit.message || "";
    if (!commit || !message.includes(`MMG-Agent-Run: ${run.id}`)) {
      return await finish(run, row, { status: "failed", error: "The run finished, but its change isn't on the branch." });
    }
    const summary = message.split("\n").slice(1).filter((l) => !l.startsWith("MMG-Agent-Run:")).join("\n").trim() || null;
    const files = commit.files?.length ?? 0;
    if (!files) return await finish(run, row, { status: "no_changes", summary, headSha: commit.sha, files });

    const work = await getWorkTask(run.workTaskId);
    const base = exec?.base || "main";
    const owner = run.repo.split("/")[0];
    const previewUrl = await findPreview(run.repo, commit.sha, exec?.previewUrl || "");
    const taskUrl = `${(row.origin as string) || "https://data.mmg.studio"}/work?task=${run.workTaskId}`;
    let pr = (await gh<GhPull[]>(`/repos/${run.repo}/pulls?head=${owner}:${encodeURIComponent(run.branch)}&state=open`))[0];
    const note = [summary, previewUrl ? `Preview: ${previewUrl}` : "", `Task in MMG Studio: ${taskUrl}`].filter(Boolean).join("\n\n");
    if (!pr) {
      pr = await gh<GhPull>(`/repos/${run.repo}/pulls`, {
        method: "POST",
        body: { title: work?.title || run.branch, head: run.branch, base, body: `${note}\n\nMade by the MMG Studio agent. Review the preview before merging.` },
      });
    } else {
      await gh(`/repos/${run.repo}/issues/${pr.number}/comments`, { method: "POST", body: { body: `Round ${run.round}${run.feedback ? ` (feedback: "${clip(run.feedback, 200)}")` : ""}\n\n${note}` } });
    }
    return await finish(run, row, { status: "done", summary, headSha: commit.sha, files, prNumber: pr.number, prUrl: pr.html_url, previewUrl });
  } catch (err) {
    // GitHub hiccup: let the next check try again.
    await setRun(id, { status: "running" });
    throw err;
  }
}

async function finish(run: AgentRun, row: Record<string, unknown>, r: {
  status: "done" | "no_changes" | "failed"; error?: string; summary?: string | null; headSha?: string; files?: number; prNumber?: number; prUrl?: string; previewUrl?: string | null;
}): Promise<AgentRun | null> {
  await setRun(run.id, {
    status: r.status, error: r.error ?? null, summary: r.summary ?? null, head_sha: r.headSha ?? null, changed_files: r.files ?? null,
    pr_number: r.prNumber ?? null, pr_url: r.prUrl ?? null, preview_url: r.previewUrl ?? null, finished_at: new Date().toISOString(),
  });
  const work = await getWorkTask(run.workTaskId);
  if (work) {
    const round = run.round > 1 ? `Round ${run.round}: ` : "";
    const ghRunUrl = (row.gh_run_url as string) || run.ghRunUrl;
    const body = r.status === "done"
      ? [`${round}Ready to review.`, r.summary || "", r.previewUrl ? `Preview: ${r.previewUrl}` : "The preview is still building. It'll show on this task when it's ready.", `Pull request: ${r.prUrl}`].filter(Boolean).join("\n\n")
      : r.status === "no_changes"
      ? [`${round}The agent finished without changing any files.`, r.summary || ""].filter(Boolean).join("\n\n")
      : [`${round}The agent couldn't finish: ${r.error}`, ghRunUrl ? `Run log: ${ghRunUrl}` : ""].filter(Boolean).join("\n\n");
    await addComment(work.id, AGENT, body);
    const moved = work.status === "todo" || work.status === "in_progress" ? await updateWorkTask(work.id, { status: "review" }) : work;
    const config = await getClient(run.clientSlug);
    await notifyAgentResult(moved, config?.name || null, (row.origin as string) || "https://data.mmg.studio", {
      outcome: r.status, round: run.round, summary: r.summary ?? null, prUrl: r.prUrl ?? null, previewUrl: r.previewUrl ?? null, runUrl: ghRunUrl || null, error: r.error ?? null,
    });
  }
  return getRun(run.id);
}

// Picks up the preview link after the run finished (the build can lag behind).
async function refreshPreview(row: Record<string, unknown>) {
  const run = rowToRun(row);
  const config = await getClient(run.clientSlug);
  const sha = row.head_sha as string | null;
  if (!sha) return;
  const url = await findPreview(run.repo, sha, githubFor(config)?.previewUrl || "");
  if (url) await setRun(run.id, { preview_url: url });
}

// Runs still in flight (plus recent ones missing a preview), checked at most
// every 20 seconds per server. Called when boards load, so the dashboard
// stays right even if GitHub's ping back never arrives.
let lastSync = 0;
export async function syncOpenRuns(): Promise<void> {
  if (Date.now() - lastSync < 20_000) return;
  lastSync = Date.now();
  const db = await getDb();
  const res = await db.execute(`SELECT * FROM agent_runs WHERE status IN ('queued', 'running')
    OR (status = 'done' AND preview_url IS NULL AND finished_at > datetime('now', '-2 hours')) ORDER BY id LIMIT 10`);
  await Promise.all(res.rows.map(async (r) => {
    const row = r as Record<string, unknown>;
    try {
      if (row.status === "done") await refreshPreview(row);
      else await syncRun(Number(row.id));
    } catch (err) {
      console.error(`Agent run ${row.id} sync failed:`, err);
    }
  }));
}
