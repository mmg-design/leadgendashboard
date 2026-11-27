import { getDb } from "./db";
import { upsertManualTask, type AgentTask, type Impact } from "./agent-tasks";

// Delegated work (Phase 2 of replacing ClickUp). Only the owner creates,
// assigns and edits tasks. A task goes to a team member, to an agent, or both;
// the assignee moves it along and comments. Clients never see any of this.

export const STATUSES = ["todo", "in_progress", "review", "done"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type WorkStatus = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export interface WorkTask {
  id: number;
  clientSlug: string | null;
  title: string;
  notes: string | null;
  status: WorkStatus;
  priority: Priority;
  assigneeId: number | null;
  agentTaskKey: string | null;
  pagePath: string | null;
  dueDate: string | null; // YYYY-MM-DD
  estimateMinutes: number | null;
  createdBy: number | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  commentCount: number;
}

export interface WorkComment {
  id: number;
  taskId: number;
  authorId: number | null;
  authorName: string;
  body: string;
  createdAt: string;
}

export const isStatus = (s: unknown): s is WorkStatus => STATUSES.includes(s as WorkStatus);
export const isPriority = (p: unknown): p is Priority => PRIORITIES.includes(p as Priority);
export const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

function rowToTask(r: Record<string, unknown>): WorkTask {
  return {
    id: Number(r.id),
    clientSlug: (r.client_slug as string) || null,
    title: r.title as string,
    notes: (r.notes as string) || null,
    status: r.status as WorkStatus,
    priority: r.priority as Priority,
    assigneeId: r.assignee_id == null ? null : Number(r.assignee_id),
    agentTaskKey: (r.agent_task_key as string) || null,
    pagePath: (r.page_path as string) || null,
    dueDate: (r.due_date as string) || null,
    estimateMinutes: r.estimate_minutes == null ? null : Number(r.estimate_minutes),
    createdBy: r.created_by == null ? null : Number(r.created_by),
    source: (r.source as string) || "manual",
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    completedAt: (r.completed_at as string) || null,
    commentCount: Number(r.comment_count || 0),
  };
}

const SELECT = `SELECT t.*, (SELECT COUNT(*) FROM work_task_comments c WHERE c.task_id = t.id) AS comment_count FROM work_tasks t`;

// Open work first (by priority, then due date), finished work last.
const ORDER = `ORDER BY t.status = 'done', CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
  t.due_date IS NULL, t.due_date, t.id DESC`;

export async function listWorkTasks(filter: { assigneeId?: number; clientSlug?: string; doneSinceDays?: number } = {}): Promise<WorkTask[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.assigneeId !== undefined) { where.push("t.assignee_id = ?"); args.push(filter.assigneeId); }
  if (filter.clientSlug) { where.push("t.client_slug = ?"); args.push(filter.clientSlug); }
  // Finished tasks drop off the board after a while; they're still in reports.
  where.push(`(t.status != 'done' OR t.completed_at > datetime('now', ?))`);
  args.push(`-${filter.doneSinceDays ?? 14} days`);
  const res = await db.execute({ sql: `${SELECT} WHERE ${where.join(" AND ")} ${ORDER}`, args });
  return res.rows.map((r) => rowToTask(r as Record<string, unknown>));
}

export async function getWorkTask(id: number): Promise<WorkTask | null> {
  const db = await getDb();
  const res = await db.execute({ sql: `${SELECT} WHERE t.id = ?`, args: [id] });
  return res.rows[0] ? rowToTask(res.rows[0] as Record<string, unknown>) : null;
}

export interface TaskInput {
  clientSlug?: string | null;
  title?: string;
  notes?: string | null;
  priority?: Priority;
  assigneeId?: number | null;
  pagePath?: string | null;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  status?: WorkStatus;
}

export async function createWorkTask(input: TaskInput & { title: string; createdBy: number | null; source?: string; sourceRef?: string | null }): Promise<WorkTask> {
  const db = await getDb();
  const res = await db.execute({
    sql: `INSERT INTO work_tasks (client_slug, title, notes, priority, assignee_id, page_path, due_date, estimate_minutes, created_by, source, source_ref)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.clientSlug || null, input.title.trim().slice(0, 200), input.notes?.trim().slice(0, 5000) || null, input.priority || "normal",
      input.assigneeId ?? null, input.pagePath || null, input.dueDate || null, input.estimateMinutes ?? null,
      input.createdBy, input.source || "manual", input.sourceRef || null,
    ],
  });
  return (await getWorkTask(Number(res.lastInsertRowid)))!;
}

export async function updateWorkTask(id: number, patch: TaskInput & { agentTaskKey?: string }): Promise<WorkTask> {
  const db = await getDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => { sets.push(`${col} = ?`); args.push(v); };
  if (patch.clientSlug !== undefined) set("client_slug", patch.clientSlug || null);
  if (typeof patch.title === "string" && patch.title.trim()) set("title", patch.title.trim().slice(0, 200));
  if (patch.notes !== undefined) set("notes", patch.notes?.trim().slice(0, 5000) || null);
  if (patch.priority) set("priority", patch.priority);
  if (patch.assigneeId !== undefined) set("assignee_id", patch.assigneeId);
  if (patch.pagePath !== undefined) set("page_path", patch.pagePath || null);
  if (patch.dueDate !== undefined) set("due_date", patch.dueDate || null);
  if (patch.estimateMinutes !== undefined) set("estimate_minutes", patch.estimateMinutes);
  if (patch.agentTaskKey !== undefined) set("agent_task_key", patch.agentTaskKey);
  if (patch.status) {
    set("status", patch.status);
    sets.push(patch.status === "done" ? "completed_at = COALESCE(completed_at, datetime('now'))" : "completed_at = NULL");
  }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    await db.execute({ sql: `UPDATE work_tasks SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  }
  return (await getWorkTask(id))!;
}

export async function deleteWorkTask(id: number) {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM work_task_comments WHERE task_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM work_tasks WHERE id = ?", args: [id] });
}

export async function listComments(taskId: number): Promise<WorkComment[]> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM work_task_comments WHERE task_id = ? ORDER BY id", args: [taskId] });
  return res.rows.map((r) => ({
    id: Number(r.id), taskId: Number(r.task_id), authorId: r.author_id == null ? null : Number(r.author_id),
    authorName: r.author_name as string, body: r.body as string, createdAt: r.created_at as string,
  }));
}

export async function addComment(taskId: number, author: { id: number | null; name: string }, body: string, mentions: number[] = []): Promise<number> {
  const db = await getDb();
  const res = await db.execute({
    sql: "INSERT INTO work_task_comments (task_id, author_id, author_name, body) VALUES (?, ?, ?, ?)",
    args: [taskId, author.id, author.name.slice(0, 80), body.trim().slice(0, 5000)],
  });
  const commentId = Number(res.lastInsertRowid);
  for (const memberId of new Set(mentions)) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO work_task_mentions (task_id, member_id, comment_id) VALUES (?, ?, ?)",
      args: [taskId, memberId, commentId],
    });
  }
  await db.execute({ sql: "UPDATE work_tasks SET updated_at = datetime('now') WHERE id = ?", args: [taskId] });
  return commentId;
}

export async function isMentioned(taskId: number, memberId: number): Promise<boolean> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT 1 FROM work_task_mentions WHERE task_id = ? AND member_id = ? LIMIT 1", args: [taskId, memberId] });
  return res.rows.length > 0;
}

// ── Agents ───────────────────────────────────────────────────────────────────
// Hands the task to an agent: creates (or refreshes) its card in the client's
// Agents tab, where the draft lives and can be applied. Needs a client.
const IMPACT: Record<Priority, Impact> = { urgent: "high", high: "high", normal: "medium", low: "low" };

export async function linkAgentTask(task: WorkTask, delegatedBy: string): Promise<string> {
  if (!task.clientSlug) throw new Error("Pick a client first: agents work on a client's site.");
  // Assigned from an existing Agents card: that card already has its own type,
  // evidence and draft. Leave it as it is and run it.
  if (task.agentTaskKey && !task.agentTaskKey.startsWith("delegated-")) return task.agentTaskKey;
  const key = task.agentTaskKey || `delegated-${task.id}`;
  const agentTask: AgentTask = {
    key,
    type: "delegated",
    category: "delegated",
    title: task.title,
    why: task.notes || task.title,
    evidence: [`Delegated by ${delegatedBy}`, ...(task.dueDate ? [`Due ${task.dueDate}`] : [])],
    impact: IMPACT[task.priority],
    score: 0,
    ...(task.pagePath ? { path: task.pagePath } : {}),
    data: { workTaskId: task.id },
  };
  await upsertManualTask(task.clientSlug, agentTask);
  if (!task.agentTaskKey) await updateWorkTask(task.id, { agentTaskKey: key });
  return key;
}

// Validates task fields from a request body. Returns an error message, or the clean input.
export function parseTaskInput(body: Record<string, unknown>): TaskInput | string {
  const out: TaskInput = {};
  if (body.clientSlug !== undefined) out.clientSlug = typeof body.clientSlug === "string" && body.clientSlug ? body.clientSlug : null;
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return "Give the task a title.";
    out.title = body.title;
  }
  if (body.notes !== undefined) out.notes = typeof body.notes === "string" ? body.notes : null;
  if (body.priority !== undefined) {
    if (!isPriority(body.priority)) return "Unknown priority.";
    out.priority = body.priority;
  }
  if (body.assigneeId !== undefined) out.assigneeId = body.assigneeId === null || body.assigneeId === "" ? null : Number(body.assigneeId);
  if (body.pagePath !== undefined) {
    const p = typeof body.pagePath === "string" ? body.pagePath.trim() : "";
    if (p && !p.startsWith("/")) return "Page paths start with a slash, like /pricing.";
    out.pagePath = p || null;
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate && !isDate(body.dueDate)) return "Use a date like 2026-12-01.";
    out.dueDate = (body.dueDate as string) || null;
  }
  if (body.estimateMinutes !== undefined) {
    const n = body.estimateMinutes === null || body.estimateMinutes === "" ? null : Math.round(Number(body.estimateMinutes));
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100_000)) return "Estimate is in minutes.";
    out.estimateMinutes = n;
  }
  return out;
}

// The Work task that an Agents card was assigned through, if any.
export async function workTaskForAgent(clientSlug: string, agentKey: string): Promise<WorkTask | null> {
  const db = await getDb();
  const res = await db.execute({ sql: `${SELECT} WHERE t.client_slug = ? AND t.agent_task_key = ? ORDER BY t.id DESC LIMIT 1`, args: [clientSlug, agentKey] });
  return res.rows[0] ? rowToTask(res.rows[0] as Record<string, unknown>) : null;
}

// The Work task for an Agents card, created the first time it's handed to
// someone (or to an agent). Context leads its instructions.
export async function workTaskForCard(card: AgentTask & { status?: string }, clientSlug: string, opts: {
  assigneeId: number | null; createdBy: number | null; byName: string; context?: string; dueDate?: string | null;
}): Promise<{ task: WorkTask; created: boolean }> {
  const existing = await workTaskForAgent(clientSlug, card.key);
  if (existing) return { task: existing, created: false };
  const notes = [opts.context ? `Context from ${opts.byName}: ${opts.context}` : "", card.why,
    card.evidence.length ? `Evidence:\n${card.evidence.map((e) => `- ${e}`).join("\n")}` : "",
    "From the Agents tab. Run the agent from this task, or open the Agents tab to review and apply its draft."].filter(Boolean).join("\n\n");
  const priority: Priority = card.impact === "high" ? "high" : card.impact === "low" ? "low" : "normal";
  let task = await createWorkTask({
    title: card.title, clientSlug, notes, priority, assigneeId: opts.assigneeId, pagePath: card.path || null,
    createdBy: opts.createdBy, source: "agent", sourceRef: card.key, dueDate: opts.dueDate || null,
  });
  task = await updateWorkTask(task.id, { agentTaskKey: card.key, ...(card.status === "drafted" ? { status: "review" as const } : {}) });
  return { task, created: true };
}
