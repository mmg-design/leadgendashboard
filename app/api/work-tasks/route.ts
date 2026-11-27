import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getAllClients } from "@/lib/clients";
import { listMembers } from "@/lib/team";
import { createWorkTask, getWorkTask, linkAgentTask, listWorkTasks, parseTaskInput } from "@/lib/work-tasks";
import { notifyAssignee, viewerId } from "@/lib/work-access";
import { trackedByTask } from "@/lib/time";
import { logoUrl } from "@/lib/client-logo";
import { executorFor, latestRuns, syncOpenRuns } from "@/lib/agent-runs";
import { hasGitHubAccess } from "@/lib/github-app";

// The owner sees every task and can create them; anyone else gets their own queue.
export async function GET(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const clientSlug = req.nextUrl.searchParams.get("client") || undefined;
  await syncOpenRuns().catch((err) => console.error("Agent run sync failed:", err));
  const [tasks, clients, runs] = await Promise.all([
    listWorkTasks(viewer.isOwner ? { clientSlug } : { assigneeId: viewerId(viewer) ?? -1, clientSlug }),
    getAllClients(),
    latestRuns(),
  ]);
  const access = await hasGitHubAccess();
  // Names, titles and photos only (for avatars and @mentions): rates never leave the Team page.
  const people = (await listMembers()).filter((m) => m.status === "active" || (viewer.isOwner && m.status === "invited"))
    .map((m) => ({ id: m.id, name: m.name, title: m.title, photoVersion: m.photoVersion }));
  // Tracked time per task: everyone's for the owner, your own otherwise.
  const tracked = await trackedByTask(tasks.map((t) => t.id), viewer.isOwner ? undefined : viewerId(viewer) ?? -1);
  return NextResponse.json({
    tasks: tasks.map((t) => {
      const run = runs.get(t.id);
      return { ...t, trackedSeconds: tracked.get(t.id) || 0, agentRun: run ? { status: run.status, round: run.round, prUrl: run.prUrl, previewUrl: run.previewUrl } : null };
    }),
    people,
    clients: clients.map((c) => ({ slug: c.slug, name: c.name, logo: logoUrl(c), agentMode: executorFor(c, access) })),
    isOwner: viewer.isOwner,
    me: viewerId(viewer),
  });
}

// Owner only. { title, clientSlug?, notes?, priority?, assigneeId?, pagePath?, dueDate?, estimateMinutes?, runWithAgent? }
export async function POST(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!viewer.isOwner) return NextResponse.json({ error: "Only the owner can create and assign tasks." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = parseTaskInput(body);
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  if (!input.title) return NextResponse.json({ error: "Give the task a title." }, { status: 400 });
  if (body.runWithAgent === true && !input.clientSlug) return NextResponse.json({ error: "Pick a client: agents work on a client's site." }, { status: 400 });

  let task = await createWorkTask({ ...input, title: input.title, createdBy: viewerId(viewer) });
  if (body.runWithAgent === true) {
    await linkAgentTask(task, viewer.name);
    task = (await getWorkTask(task.id))!;
  }
  if (task.assigneeId && task.assigneeId !== viewerId(viewer)) {
    const client = task.clientSlug ? (await getAllClients()).find((c) => c.slug === task.clientSlug) : null;
    notifyAssignee(task, viewer.name, req.nextUrl.origin, client?.name ?? null);
  }
  return NextResponse.json({ task });
}
