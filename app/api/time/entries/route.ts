import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getWorkTask } from "@/lib/work-tasks";
import { canSee } from "@/lib/work-access";
import { listMembers } from "@/lib/team";
import { addManual, entriesForTask, TimeError } from "@/lib/time";

// Time on one task. The owner sees everyone's entries; anyone else sees their own.
export async function GET(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const task = await getWorkTask(Number(req.nextUrl.searchParams.get("taskId")));
  if (!task || !canSee(viewer, task)) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  const entries = await entriesForTask(task.id, viewer.isOwner ? undefined : viewer.type === "member" ? viewer.member.id : -1);
  const people = new Map((await listMembers()).map((m) => [m.id, m]));
  return NextResponse.json({
    entries: entries.map((e) => ({ ...e, memberName: people.get(e.memberId)?.name || "Former team member", memberPhoto: people.get(e.memberId)?.photoVersion ?? null })),
    me: viewer.type === "member" ? viewer.member.id : null,
  });
}

// Manual time: { taskId, startedAt (ISO), minutes, note? } for yourself.
export async function POST(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (viewer.type !== "member") return NextResponse.json({ error: "Sign in with your own login to track time." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { taskId?: number; startedAt?: string; minutes?: number; note?: string };
  const task = await getWorkTask(Number(body.taskId));
  if (!task || !canSee(viewer, task)) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  try {
    const entry = await addManual(viewer.member.id, task.id, String(body.startedAt || ""), Number(body.minutes), body.note);
    return NextResponse.json({ entry });
  } catch (err) {
    if (err instanceof TimeError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
