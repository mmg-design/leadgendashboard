import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getDb } from "@/lib/db";
import { getAllClients } from "@/lib/clients";
import { listMembers } from "@/lib/team";
import { logoUrl } from "@/lib/client-logo";
import type { AgentTask, TaskStatus } from "@/lib/agent-tasks";
import { executorFor, latestRuns, syncOpenRuns } from "@/lib/agent-runs";
import { hasGitHubAccess } from "@/lib/github-app";

// Every client's open agent recommendations in one list, newest first, with who
// each one is assigned to. Filtering and sorting happen in the browser.
// ?closed=1 includes done and dismissed ones.
export async function GET(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const includeClosed = req.nextUrl.searchParams.get("closed") === "1";
  const db = await getDb();
  await syncOpenRuns().catch((err) => console.error("Agent run sync failed:", err));
  const [rows, linked, clients, members, runs] = await Promise.all([
    db.execute(`SELECT client_slug, task_key, task, status, output, created_at, updated_at FROM agent_tasks
                WHERE ${includeClosed ? "status != 'resolved'" : "status IN ('open', 'drafted', 'applied')"}
                ORDER BY created_at DESC LIMIT 1000`),
    db.execute("SELECT id, client_slug, agent_task_key, assignee_id, status FROM work_tasks WHERE agent_task_key IS NOT NULL ORDER BY id"),
    getAllClients(),
    listMembers(),
    latestRuns(),
  ]);
  const access = await hasGitHubAccess();
  const live = new Set(clients.map((c) => c.slug));
  const assigned = new Map(linked.rows.map((r) => [`${r.client_slug}|${r.agent_task_key}`, { taskId: Number(r.id), assigneeId: r.assignee_id == null ? null : Number(r.assignee_id), workStatus: r.status as string }]));

  const items = rows.rows
    .filter((r) => live.has(r.client_slug as string))
    .map((r) => {
      const t = JSON.parse(r.task as string) as AgentTask;
      const out = r.output ? (JSON.parse(r.output as string) as { summary?: string }) : null;
      const a = assigned.get(`${r.client_slug}|${r.task_key}`);
      const run = a ? runs.get(a.taskId) : undefined;
      return {
        clientSlug: r.client_slug as string,
        key: r.task_key as string,
        type: t.type,
        category: t.category,
        impact: t.impact,
        title: t.title,
        why: t.why,
        evidence: t.evidence.slice(0, 6),
        path: t.path || null,
        url: t.url || null,
        context: typeof t.data?.ownerContext === "string" ? t.data.ownerContext : "",
        status: r.status as TaskStatus,
        draftSummary: out?.summary || null,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
        assigned: a || null,
        run: run ? { status: run.status, round: run.round, prUrl: run.prUrl, previewUrl: run.previewUrl, error: run.error } : null,
      };
    });

  return NextResponse.json({
    items,
    clients: clients.map((c) => ({ slug: c.slug, name: c.name, logo: logoUrl(c), agentMode: executorFor(c, access) })),
    people: members.filter((m) => m.status === "active" || (viewer.isOwner && m.status === "invited")).map((m) => ({ id: m.id, name: m.name, title: m.title, photoVersion: m.photoVersion })),
    isOwner: viewer.isOwner,
    me: viewer.type === "member" ? viewer.member.id : null,
  });
}
