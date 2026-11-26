import { getDb } from "./db";
import { getWorkTask, updateWorkTask } from "./work-tasks";

// Time tracking (Phase 3 of replacing ClickUp). People clock in on a task;
// each person has at most one running timer, and starting another stops it.
// Times are stored as ISO strings in UTC.

export const MAX_RUN_HOURS = 10; // a timer left running longer is stopped and flagged
export const MAX_MANUAL_MINUTES = 16 * 60;

export interface TimeEntry {
  id: number;
  memberId: number;
  taskId: number;
  clientSlug: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null; // null while running
  note: string | null;
  source: "timer" | "manual" | "auto_stopped";
  editedAt: string | null;
  editedBy: number | null;
}

export interface RunningTimer extends TimeEntry {
  taskTitle: string;
}

const nowIso = () => new Date().toISOString();
const secondsBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000));

function rowToEntry(r: Record<string, unknown>): TimeEntry {
  return {
    id: Number(r.id),
    memberId: Number(r.member_id),
    taskId: Number(r.task_id),
    clientSlug: (r.client_slug as string) || null,
    startedAt: r.started_at as string,
    endedAt: (r.ended_at as string) || null,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    note: (r.note as string) || null,
    source: (r.source as TimeEntry["source"]) || "timer",
    editedAt: (r.edited_at as string) || null,
    editedBy: r.edited_by == null ? null : Number(r.edited_by),
  };
}

// Stops this person's running timer if it has been going too long, ending it
// at the cap and marking it so they're asked to correct it.
async function capStale(memberId: number) {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM time_entries WHERE member_id = ? AND ended_at IS NULL", args: [memberId] });
  for (const row of res.rows) {
    const e = rowToEntry(row as Record<string, unknown>);
    const capAt = new Date(Date.parse(e.startedAt) + MAX_RUN_HOURS * 3600_000).toISOString();
    if (capAt < nowIso()) {
      await db.execute({
        sql: "UPDATE time_entries SET ended_at = ?, duration_seconds = ?, source = 'auto_stopped' WHERE id = ?",
        args: [capAt, MAX_RUN_HOURS * 3600, e.id],
      });
    }
  }
}

export async function getRunning(memberId: number): Promise<RunningTimer | null> {
  await capStale(memberId);
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT e.*, t.title AS task_title FROM time_entries e JOIN work_tasks t ON t.id = e.task_id
          WHERE e.member_id = ? AND e.ended_at IS NULL ORDER BY e.id DESC LIMIT 1`,
    args: [memberId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? { ...rowToEntry(row), taskTitle: row.task_title as string } : null;
}

// Entries the timer stopped on its own that haven't been corrected yet.
export async function needsReview(memberId: number): Promise<TimeEntry[]> {
  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT * FROM time_entries WHERE member_id = ? AND source = 'auto_stopped' AND edited_at IS NULL ORDER BY id DESC LIMIT 5",
    args: [memberId],
  });
  return res.rows.map((r) => rowToEntry(r as Record<string, unknown>));
}

export async function stopTimer(memberId: number, note?: string | null): Promise<TimeEntry | null> {
  await capStale(memberId);
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM time_entries WHERE member_id = ? AND ended_at IS NULL", args: [memberId] });
  let stopped: TimeEntry | null = null;
  for (const row of res.rows) {
    const e = rowToEntry(row as Record<string, unknown>);
    const end = nowIso();
    await db.execute({
      sql: "UPDATE time_entries SET ended_at = ?, duration_seconds = ?, note = COALESCE(?, note) WHERE id = ?",
      args: [end, secondsBetween(e.startedAt, end), note?.trim().slice(0, 500) || null, e.id],
    });
    stopped = { ...e, endedAt: end, durationSeconds: secondsBetween(e.startedAt, end) };
  }
  return stopped;
}

// Starts a timer on a task, stopping whatever was running. A task still in
// To do moves to In progress.
export async function startTimer(memberId: number, taskId: number): Promise<RunningTimer> {
  const task = await getWorkTask(taskId);
  if (!task) throw new TimeError("Task not found.");
  if (task.status === "done") throw new TimeError("That task is done. Reopen it to track more time.");
  await stopTimer(memberId);
  const db = await getDb();
  await db.execute({
    sql: "INSERT INTO time_entries (member_id, task_id, client_slug, started_at, source) VALUES (?, ?, ?, ?, 'timer')",
    args: [memberId, taskId, task.clientSlug, nowIso()],
  });
  if (task.status === "todo") await updateWorkTask(taskId, { status: "in_progress" });
  return (await getRunning(memberId))!;
}

// Time added by hand for work done away from the computer.
export async function addManual(memberId: number, taskId: number, startedAt: string, minutes: number, note?: string | null): Promise<TimeEntry> {
  const task = await getWorkTask(taskId);
  if (!task) throw new TimeError("Task not found.");
  if (!Number.isFinite(Date.parse(startedAt))) throw new TimeError("Pick a date.");
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MANUAL_MINUTES) throw new TimeError("Enter between 1 minute and 16 hours.");
  if (Date.parse(startedAt) > Date.now()) throw new TimeError("That date is in the future.");
  const start = new Date(startedAt).toISOString();
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
  const db = await getDb();
  const res = await db.execute({
    sql: "INSERT INTO time_entries (member_id, task_id, client_slug, started_at, ended_at, duration_seconds, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')",
    args: [memberId, taskId, task.clientSlug, start, end, Math.round(minutes * 60), note?.trim().slice(0, 500) || null],
  });
  return (await getEntry(Number(res.lastInsertRowid)))!;
}

export async function getEntry(id: number): Promise<TimeEntry | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM time_entries WHERE id = ?", args: [id] });
  return res.rows[0] ? rowToEntry(res.rows[0] as Record<string, unknown>) : null;
}

// Corrections: the length and the note. Every edit records who made it and when.
export async function editEntry(id: number, editorId: number | null, patch: { minutes?: number; note?: string | null }): Promise<TimeEntry> {
  const e = await getEntry(id);
  if (!e) throw new TimeError("Time entry not found.");
  if (!e.endedAt) throw new TimeError("Stop the timer before editing it.");
  const sets = ["edited_at = datetime('now')", "edited_by = ?"];
  const args: (string | number | null)[] = [editorId];
  if (patch.minutes !== undefined) {
    if (!Number.isFinite(patch.minutes) || patch.minutes < 0 || patch.minutes > MAX_MANUAL_MINUTES) throw new TimeError("Enter between 0 minutes and 16 hours.");
    const seconds = Math.round(patch.minutes * 60);
    sets.push("duration_seconds = ?", "ended_at = ?");
    args.push(seconds, new Date(Date.parse(e.startedAt) + seconds * 1000).toISOString());
  }
  if (patch.note !== undefined) { sets.push("note = ?"); args.push(patch.note?.trim().slice(0, 500) || null); }
  const db = await getDb();
  await db.execute({ sql: `UPDATE time_entries SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  return (await getEntry(id))!;
}

export async function deleteEntry(id: number) {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM time_entries WHERE id = ?", args: [id] });
}

// Entries for one task, newest first (running ones count up to now).
export async function entriesForTask(taskId: number, memberId?: number): Promise<TimeEntry[]> {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT * FROM time_entries WHERE task_id = ?${memberId !== undefined ? " AND member_id = ?" : ""} ORDER BY started_at DESC`,
    args: memberId !== undefined ? [taskId, memberId] : [taskId],
  });
  return res.rows.map((r) => rowToEntry(r as Record<string, unknown>));
}

// Tracked seconds per task (finished entries plus any running timer so far).
export async function trackedByTask(taskIds: number[], memberId?: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!taskIds.length) return out;
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT task_id, started_at, ended_at, duration_seconds FROM time_entries
          WHERE task_id IN (${taskIds.map(() => "?").join(",")})${memberId !== undefined ? " AND member_id = ?" : ""}`,
    args: memberId !== undefined ? [...taskIds, memberId] : taskIds,
  });
  const now = nowIso();
  for (const r of res.rows) {
    const secs = r.duration_seconds != null ? Number(r.duration_seconds) : secondsBetween(r.started_at as string, now);
    out.set(Number(r.task_id), (out.get(Number(r.task_id)) || 0) + secs);
  }
  return out;
}

export class TimeError extends Error {}
