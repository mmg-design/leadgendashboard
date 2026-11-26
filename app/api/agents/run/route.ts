import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getTask, setTaskContext, updateTask } from "@/lib/agent-tasks";
import { runAgent } from "@/lib/agent-runner";
import { AgentError } from "@/lib/agent-llm";
import { buildPlan } from "@/lib/webflow-plan";
import { updateWorkTask, workTaskForAgent } from "@/lib/work-tasks";

// Long drafts (a full new page) can take a couple of minutes.
export const maxDuration = 300;

// Runs the agent for one task and saves its draft. Nothing is changed on the
// client's site here; applying is a separate, explicit step.
export async function POST(req: NextRequest) {
  const { client: slug, key, context } = (await req.json()) as { client?: string; key?: string; context?: string };
  if (!slug || !key) return NextResponse.json({ error: "Missing client or key" }, { status: 400 });
  // Extra context from the queue goes into the task, and from there into the prompt.
  if (typeof context === "string") await setTaskContext(slug, key, context);
  const [config, task] = await Promise.all([getClient(slug), getTask(slug, key)]);
  if (!config || !task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.type === "link_prospect") return NextResponse.json({ ok: false, error: "Link prospects are researched in Claude Code, with the pitch already written." }, { status: 400 });

  try {
    const output = await runAgent(task, config);
    output.webflowPlan = await buildPlan(task, output, config).catch((err) => {
      console.error("Webflow plan error:", err);
      return null;
    });
    const status = task.status === "applied" || task.status === "done" ? task.status : "drafted";
    await updateTask(slug, key, { output, status });
    // Handed to the agent on the Work board (no person on it): the draft is now ready to review.
    const work = await workTaskForAgent(slug, key).catch(() => null);
    if (work && !work.assigneeId && (work.status === "todo" || work.status === "in_progress")) await updateWorkTask(work.id, { status: "review" }).catch(() => {});
    return NextResponse.json({ ok: true, output, status });
  } catch (err) {
    console.error("Agent run error:", err);
    const message = err instanceof AgentError ? err.message : "The agent hit an error. Try again.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
