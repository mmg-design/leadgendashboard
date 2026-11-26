import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getClient } from "@/lib/clients";
import { getTask, setTaskContext, type Impact } from "@/lib/agent-tasks";
import { getMember } from "@/lib/team";
import { addComment, createWorkTask, isDate, updateWorkTask, workTaskForAgent, type Priority } from "@/lib/work-tasks";
import { notifyAssignee, viewerId } from "@/lib/work-access";

// Owner only: assign an Agents card to a team member. Creates its Work task the
// first time (linked to the card, so the draft and Apply stay with it) and
// reassigns it after that. { client, key, assigneeId | null, context?, dueDate? }
// Context leads the task's instructions (or is added as a comment on an existing
// task) and is also handed to the agent whenever it runs on the card.
const PRIORITY: Record<Impact, Priority> = { high: "high", medium: "normal", low: "low" };

export async function POST(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!viewer.isOwner) return NextResponse.json({ error: "Only the owner can assign work." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { client?: string; key?: string; assigneeId?: number | null; context?: string; dueDate?: string | null };
  const context = typeof body.context === "string" ? body.context.trim().slice(0, 2000) : "";
  if (body.dueDate && !isDate(body.dueDate)) return NextResponse.json({ error: "Use a date like 2026-12-01." }, { status: 400 });
  if (!body.client || !body.key) return NextResponse.json({ error: "Missing client or task." }, { status: 400 });
  const [client, card] = await Promise.all([getClient(body.client), getTask(body.client, body.key)]);
  if (!client || !card) return NextResponse.json({ error: "That task isn't on the Agents tab anymore." }, { status: 404 });

  const assigneeId = body.assigneeId == null ? null : Number(body.assigneeId);
  if (assigneeId !== null) {
    const m = await getMember(assigneeId);
    if (!m || m.status === "disabled") return NextResponse.json({ error: "That person isn't on the team." }, { status: 400 });
  }

  let task = await workTaskForAgent(client.slug, card.key);
  const previous = task?.assigneeId ?? null;
  if (!task) {
    const notes = [context ? `Context from ${viewer.name}: ${context}` : "", card.why, card.evidence.length ? `Evidence:\n${card.evidence.map((e) => `- ${e}`).join("\n")}` : "", "From the Agents tab. Run the agent from this task, or open the Agents tab to review and apply its draft."]
      .filter(Boolean).join("\n\n");
    task = await createWorkTask({
      title: card.title, clientSlug: client.slug, notes, priority: PRIORITY[card.impact], assigneeId,
      pagePath: card.path || null, createdBy: viewerId(viewer), source: "agent", sourceRef: card.key, dueDate: body.dueDate || null,
    });
    task = await updateWorkTask(task.id, { agentTaskKey: card.key, ...(card.status === "drafted" ? { status: "review" as const } : {}) });
  } else {
    if (previous !== assigneeId || body.dueDate !== undefined) task = await updateWorkTask(task.id, { assigneeId, ...(body.dueDate !== undefined ? { dueDate: body.dueDate || null } : {}) });
    if (context) await addComment(task.id, { id: viewerId(viewer), name: viewer.name }, context);
  }
  if (context) await setTaskContext(client.slug, card.key, context);
  if (assigneeId && assigneeId !== previous && assigneeId !== viewerId(viewer)) {
    notifyAssignee(task, viewer.name, req.nextUrl.origin, client.name);
  }
  return NextResponse.json({ task });
}
