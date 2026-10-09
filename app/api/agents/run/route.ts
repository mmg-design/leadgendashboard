import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getTask, updateTask } from "@/lib/agent-tasks";
import { runAgent } from "@/lib/agent-runner";
import { AgentError } from "@/lib/agent-llm";

// Long drafts (a full new page) can take a couple of minutes.
export const maxDuration = 300;

// Runs the agent for one task and saves its draft. Nothing is changed on the
// client's site here; applying is a separate, explicit step.
export async function POST(req: NextRequest) {
  const { client: slug, key } = (await req.json()) as { client?: string; key?: string };
  if (!slug || !key) return NextResponse.json({ error: "Missing client or key" }, { status: 400 });
  const [config, task] = await Promise.all([getClient(slug), getTask(slug, key)]);
  if (!config || !task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  try {
    const output = await runAgent(task, config);
    const status = task.status === "applied" || task.status === "done" ? task.status : "drafted";
    await updateTask(slug, key, { output, status });
    return NextResponse.json({ ok: true, output, status });
  } catch (err) {
    console.error("Agent run error:", err);
    const message = err instanceof AgentError ? err.message : "The agent hit an error. Try again.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
