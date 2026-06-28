import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

async function cuFetch(path: string, apiKey: string, fresh = false) {
  const res = await fetch(`${CLICKUP_BASE}${path}`, {
    headers: { Authorization: apiKey },
    ...(fresh ? { cache: "no-store" } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ClickUp ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  const clientSlug = req.nextUrl.searchParams.get("client");
  if (!clientSlug) return NextResponse.json({ error: "Missing client" }, { status: 400 });

  const apiKey = process.env.CLICKUP_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "CLICKUP_API_KEY not set" }, { status: 503 });

  const fresh = req.nextUrl.searchParams.has("_t");

  try {
    const clientConfig = await getClient(clientSlug);
    const cuConfig = clientConfig?.integrations?.clickup;
    if (!cuConfig?.enabled) {
      return NextResponse.json({ error: "ClickUp not enabled" }, { status: 404 });
    }
    const listIds: string[] = cuConfig.listIds ?? [];
    if (listIds.length === 0) {
      return NextResponse.json({ error: "No ClickUp lists configured" }, { status: 400 });
    }

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 86400000;
    const sevenDaysAgo = now - 7 * 86400000;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const listResults = await Promise.all(
      listIds.map(async (listId) => {
        const [listInfo, activeTasks, closedTasks] = await Promise.all([
          cuFetch(`/list/${listId}`, apiKey, fresh),
          cuFetch(`/list/${listId}/task?include_closed=false&subtasks=true`, apiKey, fresh),
          cuFetch(
            `/list/${listId}/task?include_closed=true&statuses[]=complete&statuses[]=done&date_done_gt=${thirtyDaysAgo}`,
            apiKey,
            fresh
          ),
        ]);
        return {
          listId,
          listName: (listInfo.name as string) || listId,
          activeTasks: (activeTasks.tasks as any[]) || [],
          closedTasks: (closedTasks.tasks as any[]) || [],
        };
      })
    );

    const allActive: any[] = [];
    const allCompleted: any[] = [];
    const phaseGroups: Record<string, number> = {};
    const memberMap = new Map<string, { name: string; email: string; color?: string }>();

    for (const result of listResults) {
      const phase = result.listName;
      const tagged = (tasks: any[]) => tasks.map((t) => ({ ...t, _phase: phase }));

      // Split: "done" status tasks count as completed, not active
      const trulyActive = result.activeTasks.filter((t: any) => t.status?.status !== "done");
      const doneButOpen = result.activeTasks.filter((t: any) => t.status?.status === "done");
      allActive.push(...tagged(trulyActive));
      allCompleted.push(...tagged([...doneButOpen, ...result.closedTasks]));
      phaseGroups[phase] = (phaseGroups[phase] ?? 0) + trulyActive.length;

      for (const task of [...result.activeTasks, ...result.closedTasks]) {
        if (Array.isArray(task.assignees)) {
          for (const a of task.assignees) {
            const key = String(a.id ?? a.email ?? a.username);
            if (!memberMap.has(key)) {
              memberMap.set(key, {
                name: a.username || a.email || "Team member",
                email: a.email || "",
                color: a.color,
              });
            }
          }
        }
      }
    }

    const overdueCount = allActive.filter(
      (t) => t.due_date && Number(t.due_date) < now
    ).length;

    const completedThisMonthCount = allCompleted.filter((t) => {
      const ts = Number(t.date_done || t.date_updated || 0);
      return ts >= startOfMonth.getTime();
    }).length;

    const activityFeed = allCompleted
      .map((t) => ({ ...t, _sortTs: Number(t.date_done || t.date_updated || 0) }))
      .filter((t) => t._sortTs > 0)
      .sort((a, b) => b._sortTs - a._sortTs)
      .slice(0, 10)
      .map((t) => ({
        id: t.id as string,
        name: t.name as string,
        phase: t._phase as string,
        completedAt: new Date(t._sortTs).toISOString(),
      }));

    // Tasks updated in last 7 days — fetch comments for up to 5
    const recentlyUpdated = allActive
      .filter((t) => t.date_updated && Number(t.date_updated) >= sevenDaysAgo)
      .sort((a, b) => Number(b.date_updated) - Number(a.date_updated))
      .slice(0, 5);

    const tasksWithComments: {
      id: string;
      name: string;
      phase: string;
      latestComment: string;
      commentDate: string;
    }[] = [];

    await Promise.all(
      recentlyUpdated.map(async (task) => {
        try {
          const data = await cuFetch(`/task/${task.id}/comment`, apiKey, fresh);
          const comments: any[] = data.comments || [];
          if (comments.length > 0) {
            const latest = comments[comments.length - 1];
            const text =
              typeof latest.comment_text === "string"
                ? latest.comment_text
                : latest.comment?.map((c: any) => c.text || "").join("") || "";
            if (text.trim()) {
              tasksWithComments.push({
                id: task.id as string,
                name: task.name as string,
                phase: task._phase as string,
                latestComment: text,
                commentDate: new Date(Number(latest.date)).toISOString(),
              });
            }
          }
        } catch {
          // ignore per-task comment failures
        }
      })
    );

    // Time tracking: call team endpoint once per assignee (single assignee per call is required)
    // Filter results to task IDs from the configured lists to avoid counting other clients' work
    const ebTaskIdSet = new Set(
      listResults.flatMap((r) =>
        [...r.activeTasks, ...r.closedTasks].map((t) => t.id as string).filter(Boolean)
      )
    );

    const workspaceId = cuConfig.workspaceId as string | undefined;
    let timeTrackedThisMonthMs = 0;

    if (workspaceId) {
      try {
        const startMs = startOfMonth.getTime();
        // Use all member IDs found on tasks; extras from config in case some members have no current assignees
        const configMemberIds: string[] = (cuConfig.teamMemberIds as string[] | undefined) ?? [];
        const memberIds = Array.from(new Set([...memberMap.keys(), ...configMemberIds]));

        const timeResults = await Promise.allSettled(
          memberIds.map((memberId) =>
            fetch(`${CLICKUP_BASE}/team/${workspaceId}/time_entries?start_date=${startMs}&end_date=${now}&assignee=${memberId}`, {
              headers: { Authorization: apiKey },
              cache: "no-store",
            }).then((r) => (r.ok ? r.json() : Promise.resolve({ data: [] })))
          )
        );

        for (const result of timeResults) {
          if (result.status === "fulfilled") {
            const entries: any[] = result.value?.data ?? [];
            for (const entry of entries) {
              const taskId = entry.task?.id;
              if (taskId && ebTaskIdSet.has(taskId)) {
                timeTrackedThisMonthMs += Number(entry.duration || 0);
              }
            }
          } else {
            console.error("Time tracking member fetch failed:", result.reason);
          }
        }
      } catch (e) {
        console.error("ClickUp time tracking error:", e);
      }
    }

    return NextResponse.json({
      activeTaskCount: allActive.length,
      completedThisMonthCount,
      overdueCount,
      phaseGroups: Object.entries(phaseGroups).map(([phase, count]) => ({ phase, count })),
      activityFeed,
      tasksWithComments: tasksWithComments.slice(0, 5),
      teamMembers: Array.from(memberMap.values()),
      engagementStartDate: cuConfig.engagementStartDate ?? null,
      timeTrackedThisMonthMs,
    });
  } catch (err: any) {
    console.error("ClickUp error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch ClickUp data" },
      { status: 500 }
    );
  }
}
