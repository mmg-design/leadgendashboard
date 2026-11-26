import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getClient } from "@/lib/clients";
import { getWorkTask } from "@/lib/work-tasks";
import { canSee, notifyOwner } from "@/lib/work-access";
import { getRunning, needsReview, startTimer, stopTimer, TimeError, MAX_RUN_HOURS } from "@/lib/time";

// The signed-in person's timer. Time is tracked per person, so the shared
// workspace password can't clock in: it has no person behind it.
const NO_PERSON = "Sign in with your own login to track time.";

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (viewer.type !== "member") return NextResponse.json({ running: null, needsReview: [], canTrack: false, reason: NO_PERSON });
  const running = await getRunning(viewer.member.id);
  const client = running?.clientSlug ? await getClient(running.clientSlug) : null;
  return NextResponse.json({
    running: running && { ...running, clientName: client?.name ?? null },
    needsReview: await needsReview(viewer.member.id),
    canTrack: true,
    maxHours: MAX_RUN_HOURS,
  });
}

// { action: "start", taskId } or { action: "stop", note? }
export async function POST(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (viewer.type !== "member") return NextResponse.json({ error: NO_PERSON }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; taskId?: number; note?: string };
  try {
    if (body.action === "stop") {
      return NextResponse.json({ stopped: await stopTimer(viewer.member.id, body.note), running: null });
    }
    if (body.action === "start") {
      const task = await getWorkTask(Number(body.taskId));
      if (!task || !canSee(viewer, task)) return NextResponse.json({ error: "Task not found." }, { status: 404 });
      const running = await startTimer(viewer.member.id, task.id);
      const client = running.clientSlug ? await getClient(running.clientSlug) : null;
      if (task.status === "todo") {
        notifyOwner({ kind: "status", from: "todo", to: "in_progress" }, { ...task, status: "in_progress" }, { name: viewer.name, isOwner: viewer.isOwner }, req.nextUrl.origin, client?.name ?? null);
      }
      return NextResponse.json({ running: { ...running, clientName: client?.name ?? null } });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    if (err instanceof TimeError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
