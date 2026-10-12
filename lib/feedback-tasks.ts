import { getDb } from "./db";
import { getReviewLink, listFeedback, type Feedback } from "./feedback";
import type { AgentTask, TaskStatus } from "./agent-tasks";

// Client feedback lives on its own tab; only unresolved comments show up in
// the Agents queue. This keeps the two in step: open comments become tasks,
// resolved ones leave the queue, and a reopened comment comes back.

const DEVICE: Record<string, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

export const feedbackTaskKey = (id: number) => `feedback:${id}`;
export const feedbackIdFromKey = (key: string) => (key.startsWith("feedback:") ? Number(key.slice(9)) : null);

function stamp(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

function toTask(f: Feedback, reviewUrl: string): AgentTask {
  const ageDays = (Date.now() - new Date(`${f.createdAt.replace(" ", "T")}Z`).getTime()) / 86_400_000;
  const short = f.body.replace(/\s+/g, " ").slice(0, 90);
  return {
    key: feedbackTaskKey(f.id),
    type: "client_feedback",
    category: "feedback",
    title: `Client feedback #${f.number} on ${f.pagePath}: “${short}${f.body.length > 90 ? "…" : ""}”`,
    why: f.body,
    evidence: [
      `${f.authorName} · ${stamp(f.createdAt)} ET · ${DEVICE[f.device] || f.device}${f.viewportWidth ? ` ${f.viewportWidth}px` : ""}${f.browser ? ` · ${f.browser}` : ""}`,
      ...(f.anchor?.text ? [`Pinned on: “${f.anchor.text.slice(0, 120)}”`] : []),
      ...f.replies.map((r) => `${r.isTeam ? "MMG" : r.authorName} replied ${stamp(r.createdAt)}: ${r.body.slice(0, 160)}`),
      ...(f.status === "in_progress" ? ["Marked in progress"] : []),
    ],
    impact: ageDays > 3 ? "high" : "medium",
    // Feedback sorts above everything else in its group, oldest first.
    score: 10_000 - f.number,
    path: f.pagePath,
    url: f.pageUrl,
    data: { feedbackId: f.id, reviewUrl: `${reviewUrl}?c=${f.id}`, selector: f.anchor?.selector || null, device: f.device },
  };
}

export async function syncFeedbackTasks(slug: string, appOrigin: string) {
  const db = await getDb();
  const comments = (await listFeedback(slug)).filter((f) => f.kind === "comment");
  if (comments.length === 0) return;
  const token = await getReviewLink(slug);
  const reviewUrl = `${appOrigin}/review/${token}`;
  const existing = await db.execute({
    sql: "SELECT task_key, status FROM agent_tasks WHERE client_slug = ? AND task_key LIKE 'feedback:%'",
    args: [slug],
  });
  const statusByKey = new Map(existing.rows.map((r) => [r.task_key as string, r.status as TaskStatus]));

  for (const f of comments) {
    const key = feedbackTaskKey(f.id);
    const current = statusByKey.get(key);
    if (f.status === "resolved") {
      if (current && !["done", "dismissed", "resolved"].includes(current)) {
        await db.execute({ sql: "UPDATE agent_tasks SET status = 'done', updated_at = datetime('now') WHERE client_slug = ? AND task_key = ?", args: [slug, key] });
      }
      continue;
    }
    const task = JSON.stringify(toTask(f, reviewUrl));
    if (!current) {
      await db.execute({ sql: "INSERT INTO agent_tasks (client_slug, task_key, task, status) VALUES (?, ?, ?, 'open')", args: [slug, key, task] });
    } else {
      // Reopened in the review tool: back into the queue (dismissed stays dismissed).
      const status = current === "done" || current === "resolved" ? "open" : current;
      await db.execute({
        sql: "UPDATE agent_tasks SET task = ?, status = ? WHERE client_slug = ? AND task_key = ?",
        args: [task, status, slug, key],
      });
    }
  }
}
