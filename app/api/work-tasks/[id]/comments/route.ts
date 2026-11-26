import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getClient } from "@/lib/clients";
import { listMembers } from "@/lib/team";
import { addComment, getWorkTask, listComments } from "@/lib/work-tasks";
import { canAccess, notifyMentions, notifyOwner, viewerId } from "@/lib/work-access";

type Params = { params: Promise<{ id: string }> };

// The owner, the assignee and anyone @mentioned can comment. { body, mentions?: memberId[] }
// Mentioned people are emailed; the owner hears about comments from anyone else.
export async function POST(req: NextRequest, { params }: Params) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const task = await getWorkTask(Number((await params).id));
  if (!task || !(await canAccess(viewer, task))) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  const { body, mentions } = (await req.json().catch(() => ({}))) as { body?: string; mentions?: unknown };
  if (!body?.trim()) return NextResponse.json({ error: "Write a comment first." }, { status: 400 });

  const active = new Set((await listMembers()).filter((m) => m.status === "active").map((m) => m.id));
  const tagged = Array.isArray(mentions) ? [...new Set(mentions.map(Number))].filter((id) => active.has(id)) : [];
  const author = { id: viewerId(viewer), name: viewer.name };
  await addComment(task.id, author, body, tagged);

  const client = task.clientSlug ? await getClient(task.clientSlug) : null;
  const origin = req.nextUrl.origin;
  notifyMentions(task, tagged, author, body.trim(), origin, client?.name ?? null);
  notifyOwner({ kind: "comment", body: body.trim() }, task, { name: viewer.name, isOwner: viewer.isOwner }, origin, client?.name ?? null);
  return NextResponse.json({ comments: await listComments(task.id) });
}
