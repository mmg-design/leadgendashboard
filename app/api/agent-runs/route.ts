import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getClient } from "@/lib/clients";
import { getTask, setTaskContext } from "@/lib/agent-tasks";
import { addComment, getWorkTask, isDate, workTaskForCard } from "@/lib/work-tasks";
import { canAccess, viewerId } from "@/lib/work-access";
import { executorFor, listRuns, RunError, startRun, syncOpenRuns } from "@/lib/agent-runs";
import { hasGitHubAccess } from "@/lib/github-app";

// GET ?workTaskId= : the task's agent runs (round by round) and whether its
// client's code is connected. Anyone who can open the task can see them.
export async function GET(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const work = await getWorkTask(Number(req.nextUrl.searchParams.get("workTaskId")));
  if (!work || !(await canAccess(viewer, work))) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  await syncOpenRuns().catch((err) => console.error("Agent run sync failed:", err));
  const config = work.clientSlug ? await getClient(work.clientSlug) : null;
  return NextResponse.json({ runs: await listRuns(work.id), executor: executorFor(config, await hasGitHubAccess()), isOwner: viewer.isOwner });
}

// POST, owner only: hand a task to the agent to carry out in the client's code.
//   { workTaskId, feedback? }            an existing Work task; feedback = "send back" notes
//   { client, key, context?, dueDate? }   straight from an Agents card (creates its Work task)
export async function POST(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!viewer.isOwner) return NextResponse.json({ error: "Only the owner can hand work to the agent." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { workTaskId?: number; feedback?: string; client?: string; key?: string; context?: string; dueDate?: string | null };
  const by = { id: viewerId(viewer), name: viewer.name };

  let workTaskId = Number(body.workTaskId) || 0;
  if (!workTaskId) {
    if (!body.client || !body.key) return NextResponse.json({ error: "Missing task." }, { status: 400 });
    if (body.dueDate && !isDate(body.dueDate)) return NextResponse.json({ error: "Use a date like 2026-12-01." }, { status: 400 });
    const [client, card] = await Promise.all([getClient(body.client), getTask(body.client, body.key)]);
    if (!client || !card) return NextResponse.json({ error: "That task isn't on the Agents tab anymore." }, { status: 404 });
    const context = typeof body.context === "string" ? body.context.trim().slice(0, 2000) : "";
    const { task, created } = await workTaskForCard(card, client.slug, { assigneeId: null, createdBy: by.id, byName: by.name, context, dueDate: body.dueDate });
    if (context) {
      await setTaskContext(client.slug, card.key, context);
      if (!created) await addComment(task.id, by, context);
    }
    workTaskId = task.id;
  }

  const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
  if (feedback) await addComment(workTaskId, by, `Sent back to the agent: ${feedback}`);
  try {
    const run = await startRun({ workTaskId, feedback, by, origin: req.nextUrl.origin });
    return NextResponse.json({ run, task: await getWorkTask(workTaskId) });
  } catch (err) {
    const message = err instanceof RunError ? err.message : "Couldn't start the agent.";
    if (!(err instanceof RunError)) console.error("Agent run start failed:", err);
    return NextResponse.json({ error: message, task: await getWorkTask(workTaskId) }, { status: 400 });
  }
}
