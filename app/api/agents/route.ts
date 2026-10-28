import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { lastScan, listTasks, saveScan, scanClient, scanIsStale, updateTask, type TaskStatus } from "@/lib/agent-tasks";
import { agentModelName } from "@/lib/agent-llm";
import { feedbackIdFromKey, syncFeedbackTasks } from "@/lib/feedback-tasks";
import { getFeedback, getReviewLink, setFeedbackStatus, slackTsFor } from "@/lib/feedback";
import { notifyStatus } from "@/lib/slack";
import { recordEvent } from "@/lib/site-events";
import { getTask } from "@/lib/agent-tasks";

export const maxDuration = 120;

// The Agents tab's task list. Scans automatically when the last scan is more
// than 12 hours old, or on demand with ?scan=1.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  let scan = await lastScan(slug);
  if (req.nextUrl.searchParams.get("scan") === "1" || scanIsStale(scan)) {
    try {
      const result = await scanClient(slug, config);
      await saveScan(slug, result.tasks, result.summary);
      scan = result.summary;
    } catch (err) {
      console.error("Agent scan error:", err);
      if (!scan) return NextResponse.json({ error: "The scan failed. Try again in a minute." }, { status: 500 });
    }
  }

  // Unresolved client feedback joins the queue (resolved comments leave it).
  await syncFeedbackTasks(slug, req.nextUrl.origin).catch((err) => console.error("Feedback sync error:", err));

  const webflow = config.integrations.webflow;
  return NextResponse.json({
    tasks: await listTasks(slug),
    scan,
    model: agentModelName(),
    webflow: webflow?.enabled && webflow.apiToken ? { connected: true, siteName: webflow.siteName || null } : { connected: false },
    clickup: !!(config.integrations.clickup?.enabled && config.integrations.clickup.listIds?.length && process.env.CLICKUP_API_KEY),
  });
}

const STATUSES: TaskStatus[] = ["open", "drafted", "applied", "done", "dismissed"];

// Mark a task done, dismiss it, or reopen it.
export async function PATCH(req: NextRequest) {
  const { client: slug, key, status } = (await req.json()) as { client?: string; key?: string; status?: TaskStatus };
  if (!slug || !key || !status || !STATUSES.includes(status)) return NextResponse.json({ error: "Missing client, key, or status" }, { status: 400 });
  await updateTask(slug, key, { status });

  // Finished work goes on the change timeline (client feedback is logged as
  // "feedback resolved" below instead).
  if (status === "done" && !key.startsWith("feedback:")) {
    const task = await getTask(slug, key);
    if (task) await recordEvent(slug, { kind: "agent_task", title: task.title, pages: task.path ? [task.path] : [], source: "Agents", ref: `task:${key}` });
  }

  // Done on a client-feedback task resolves the comment itself (and tells Slack);
  // reopening the task reopens the comment.
  const feedbackId = feedbackIdFromKey(key);
  if (feedbackId && (status === "done" || status === "open")) {
    const item = await getFeedback(slug, feedbackId);
    const next = status === "done" ? "resolved" : "open";
    const client = await getClient(slug);
    if (item && item.status !== next && client && (await getReviewLink(slug, false))) {
      await setFeedbackStatus(feedbackId, next);
      await notifyStatus(await slackTsFor(feedbackId), item, client.name, next, "MMG Studio");
      if (next === "resolved") {
        await recordEvent(slug, { kind: "feedback_resolved", title: `Client feedback resolved: “${item.body.slice(0, 80)}”`, pages: [item.pagePath], source: "Client feedback", ref: `feedback:${item.id}` });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
