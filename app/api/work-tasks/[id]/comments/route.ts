import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { addComment, getWorkTask, listComments } from "@/lib/work-tasks";
import { canSee, viewerId } from "@/lib/work-access";

type Params = { params: Promise<{ id: string }> };

// The owner and the assignee can comment.
export async function POST(req: NextRequest, { params }: Params) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const task = await getWorkTask(Number((await params).id));
  if (!task || !canSee(viewer, task)) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  const { body } = (await req.json().catch(() => ({}))) as { body?: string };
  if (!body?.trim()) return NextResponse.json({ error: "Write a comment first." }, { status: 400 });
  await addComment(task.id, { id: viewerId(viewer), name: viewer.name }, body);
  return NextResponse.json({ comments: await listComments(task.id) });
}
