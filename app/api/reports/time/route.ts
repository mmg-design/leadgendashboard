import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getDb } from "@/lib/db";
import { getAllClients } from "@/lib/clients";
import { listMembers } from "@/lib/team";
import { trackedByTask } from "@/lib/time";
import { logoUrl } from "@/lib/client-logo";

// Weekly time report. The owner sees everyone, with contractor cost; anyone
// else sees only their own time and never a rate or cost.
// ?from=ISO&to=ISO (the viewer's local week, computed in the browser)
// &tz=Area/City (to put each entry on the right local day) [&format=csv]

const MAX_RANGE_DAYS = 31;

function localDay(iso: string, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  let tz = sp.get("tz") || "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); } catch { tz = "UTC"; }
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
    return NextResponse.json({ error: "Pick a week." }, { status: 400 });
  }
  if (!viewer.isOwner && viewer.type !== "member") return NextResponse.json({ error: "Sign in with your own login to see your time." }, { status: 403 });

  const onlyMe = viewer.isOwner ? null : viewer.type === "member" ? viewer.member.id : -1;
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT e.*, t.title AS task_title, t.estimate_minutes, t.assignee_id FROM time_entries e
          JOIN work_tasks t ON t.id = e.task_id
          WHERE e.started_at >= ? AND e.started_at < ?${onlyMe !== null ? " AND e.member_id = ?" : ""}
          ORDER BY e.started_at`,
    args: onlyMe !== null ? [new Date(fromMs).toISOString(), new Date(toMs).toISOString(), onlyMe] : [new Date(fromMs).toISOString(), new Date(toMs).toISOString()],
  });

  const now = new Date().toISOString();
  const owner = viewer.isOwner;
  const entries = res.rows.map((r) => {
    const seconds = r.duration_seconds != null ? Number(r.duration_seconds) : Math.max(0, Math.round((Date.parse(now) - Date.parse(r.started_at as string)) / 1000));
    const rate = r.rate_cents == null ? null : Number(r.rate_cents);
    return {
      id: Number(r.id),
      memberId: Number(r.member_id),
      taskId: Number(r.task_id),
      taskTitle: r.task_title as string,
      clientSlug: (r.client_slug as string) || null,
      day: localDay(r.started_at as string, tz),
      startedAt: r.started_at as string,
      endedAt: (r.ended_at as string) || null,
      seconds,
      running: r.ended_at == null,
      note: (r.note as string) || null,
      source: r.source as string,
      edited: !!r.edited_at,
      ...(owner ? { rateCents: rate, costCents: rate == null ? null : Math.round((seconds / 3600) * rate) } : {}),
    };
  });

  const [members, clients] = await Promise.all([listMembers(), getAllClients()]);
  const people = members
    .filter((m) => (owner ? m.status !== "disabled" || entries.some((e) => e.memberId === m.id) : m.id === onlyMe))
    .map((m) => ({ id: m.id, name: m.name, title: m.title, kind: m.kind, photoVersion: m.photoVersion }));
  const clientNames = Object.fromEntries(clients.map((c) => [c.slug, c.name]));

  if (sp.get("format") === "csv") {
    const name = new Map(members.map((m) => [m.id, m.name]));
    const header = ["Date", "Person", "Client", "Task", "Start", "End", "Hours", "Note", "Source", ...(owner ? ["Rate ($/hr)", "Cost ($)"] : [])];
    const rows = entries.map((e) => [
      e.day, name.get(e.memberId) || "", e.clientSlug ? clientNames[e.clientSlug] || e.clientSlug : "Internal", e.taskTitle,
      e.startedAt, e.endedAt || "running", (e.seconds / 3600).toFixed(2), e.note || "",
      e.source === "auto_stopped" ? "auto-stopped" : e.source + (e.edited ? " (edited)" : ""),
      ...(owner ? [e.rateCents == null ? "" : (e.rateCents / 100).toFixed(2), e.costCents == null ? "" : (e.costCents / 100).toFixed(2)] : []),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="time-${localDay(new Date(fromMs).toISOString(), tz)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // All-time tracked per task (yours only if you're not the owner), to compare with the estimate.
  const taskIds = [...new Set(entries.map((e) => e.taskId))];
  const totals = await trackedByTask(taskIds, onlyMe ?? undefined);
  const estimate = new Map(res.rows.map((r) => [Number(r.task_id), r.estimate_minutes == null ? null : Number(r.estimate_minutes)]));
  const assignee = new Map(res.rows.map((r) => [Number(r.task_id), r.assignee_id == null ? null : Number(r.assignee_id)]));
  const days = Array.from({ length: Math.round((toMs - fromMs) / 86_400_000) }, (_, i) => localDay(new Date(fromMs + i * 86_400_000 + 3_600_000).toISOString(), tz));

  return NextResponse.json({
    isOwner: owner,
    days,
    people,
    clients: clientNames,
    logos: Object.fromEntries(clients.map((c) => [c.slug, logoUrl(c)])),
    entries,
    tasks: taskIds.map((id) => ({ id, totalSeconds: totals.get(id) || 0, estimateMinutes: estimate.get(id) ?? null, assigneeId: assignee.get(id) ?? null })),
  });
}
