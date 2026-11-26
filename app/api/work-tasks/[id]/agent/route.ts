import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getClient } from "@/lib/clients";
import { getTask, updateTask } from "@/lib/agent-tasks";
import { runAgent } from "@/lib/agent-runner";
import { AgentError } from "@/lib/agent-llm";
import { getWorkTask, linkAgentTask, updateWorkTask } from "@/lib/work-tasks";
import { canSee } from "@/lib/work-access";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

// Runs an agent on the task (the owner, or the person it's assigned to). The
// draft lands in the client's Agents tab too, where it can be applied; nothing
// changes on the client's site here. The task moves to review.
export async function POST(req: NextRequest, { params }: Params) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const work = await getWorkTask(Number((await params).id));
  if (!work || !canSee(viewer, work)) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  if (!work.clientSlug) return NextResponse.json({ error: "Pick a client first: agents work on a client's site." }, { status: 400 });

  try {
    const key = await linkAgentTask(work, viewer.name);
    const [config, task] = await Promise.all([getClient(work.clientSlug), getTask(work.clientSlug, key)]);
    if (!config || !task) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    const output = await runAgent(task, config);
    await updateTask(work.clientSlug, key, { output, status: task.status === "applied" || task.status === "done" ? task.status : "drafted" });
    const updated = work.status === "todo" || work.status === "in_progress" ? await updateWorkTask(work.id, { status: "review" }) : work;
    return NextResponse.json({ ok: true, output, task: updated });
  } catch (err) {
    console.error("Delegated agent run failed:", err);
    const message = err instanceof AgentError ? err.message : err instanceof Error && err.message.startsWith("Pick a client") ? err.message : "The agent hit an error. Try again.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
