import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getClient } from "@/lib/clients";
import { getTask } from "@/lib/agent-tasks";
import { deleteWorkTask, getWorkTask, isStatus, listComments, parseTaskInput, updateWorkTask } from "@/lib/work-tasks";
import { canSee, notifyAssignee, viewerId } from "@/lib/work-access";

type Params = { params: Promise<{ id: string }> };

async function load(req: NextRequest, params: Params["params"]) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const task = await getWorkTask(Number((await params).id));
  if (!task || !canSee(viewer, task)) return { error: NextResponse.json({ error: "Task not found." }, { status: 404 }) };
  return { viewer, task };
}

// The task with its comments and, when an agent is on it, the agent's draft.
export async function GET(req: NextRequest, { params }: Params) {
  const r = await load(req, params);
  if ("error" in r) return r.error;
  const { task } = r;
  const agent = task.agentTaskKey && task.clientSlug ? await getTask(task.clientSlug, task.agentTaskKey) : null;
  return NextResponse.json({
    task,
    comments: await listComments(task.id),
    agent: agent ? { key: agent.key, status: agent.status, output: agent.output } : null,
  });
}

// The owner can change anything; the assignee can only move the status.
export async function PATCH(req: NextRequest, { params }: Params) {
  const r = await load(req, params);
  if ("error" in r) return r.error;
  const { viewer, task } = r;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.status !== undefined && !isStatus(body.status)) return NextResponse.json({ error: "Unknown status." }, { status: 400 });

  if (!viewer.isOwner) {
    const extra = Object.keys(body).filter((k) => k !== "status");
    if (extra.length) return NextResponse.json({ error: "Only the owner can change task details." }, { status: 403 });
    return NextResponse.json({ task: await updateWorkTask(task.id, { status: body.status as never }) });
  }

  const input = parseTaskInput(body);
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  const updated = await updateWorkTask(task.id, { ...input, ...(isStatus(body.status) ? { status: body.status } : {}) });
  if (input.assigneeId && input.assigneeId !== task.assigneeId && input.assigneeId !== viewerId(viewer)) {
    const client = updated.clientSlug ? await getClient(updated.clientSlug) : null;
    notifyAssignee(updated, viewer.name, req.nextUrl.origin, client?.name ?? null);
  }
  return NextResponse.json({ task: updated });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const r = await load(req, params);
  if ("error" in r) return r.error;
  if (!r.viewer.isOwner) return NextResponse.json({ error: "Only the owner can delete tasks." }, { status: 403 });
  await deleteWorkTask(r.task.id);
  return NextResponse.json({ ok: true });
}
