import { getDb } from "./db";

// The change timeline behind the chart markers. Events are written where the
// change happens (Agents, Webflow publishes, the review tool, the daily site
// check) and read by every chart, so all tabs show the same history.

export type EventKind =
  | "agent_task" // an Agents task marked done
  | "published" // an agent's change published to the live site from MMG Pulse
  | "page_added"
  | "page_removed"
  | "site_published" // a Webflow publish made outside MMG Pulse
  | "feedback_resolved"
  | "sitemap" // sitemap resubmitted to Google
  | "note" // added by hand
  | "google_update"; // Google ranking update (global, not stored per client)

export interface SiteEvent {
  id: number | string;
  occurredAt: string; // ISO
  day: string; // YYYY-MM-DD, US Eastern (matches the GA properties' reporting days)
  kind: EventKind;
  title: string;
  detail: string | null;
  pages: string[];
  source: string;
  ref: string;
  manual: boolean;
}

const TZ = "America/New_York";

export function dayOf(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function toIso(s: string) {
  return new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`).toISOString();
}

export async function addEvent(
  slug: string,
  e: { kind: EventKind; title: string; detail?: string | null; pages?: string[]; source: string; ref: string; occurredAt?: string }
) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO site_events (client_slug, occurred_at, kind, title, detail, pages, source, ref)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      slug,
      toIso(e.occurredAt || new Date().toISOString()),
      e.kind,
      e.title.slice(0, 300),
      e.detail?.slice(0, 2000) || null,
      JSON.stringify((e.pages || []).slice(0, 200)),
      e.source,
      e.ref.slice(0, 400),
    ],
  });
}

// Never let a timeline write break the action that triggered it.
export function recordEvent(slug: string, e: Parameters<typeof addEvent>[1]) {
  return addEvent(slug, e).catch((err) => console.error("Event log error:", err));
}

export async function listEvents(slug: string, days = 400): Promise<SiteEvent[]> {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = await db.execute({
    sql: "SELECT * FROM site_events WHERE client_slug = ? AND occurred_at >= ? ORDER BY occurred_at DESC",
    args: [slug, since],
  });
  return res.rows.map((r) => ({
    id: Number(r.id),
    occurredAt: r.occurred_at as string,
    day: dayOf(r.occurred_at as string),
    kind: r.kind as EventKind,
    title: r.title as string,
    detail: (r.detail as string) || null,
    pages: r.pages ? JSON.parse(r.pages as string) : [],
    source: r.source as string,
    ref: r.ref as string,
    manual: r.kind === "note",
  }));
}

export async function getEvent(slug: string, id: number) {
  return (await listEvents(slug, 3650)).find((e) => e.id === id) || null;
}

export async function addNote(slug: string, input: { day: string; title: string; page?: string | null }) {
  // Noon Eastern keeps the note on the day it was picked in every timezone.
  const occurredAt = new Date(`${input.day}T16:00:00Z`).toISOString();
  await addEvent(slug, {
    kind: "note",
    title: input.title,
    pages: input.page ? [input.page] : [],
    source: "Note",
    ref: `note:${crypto.randomUUID()}`,
    occurredAt,
  });
}

// Notes are the only events people create by hand, so they're the only ones
// that can be removed from the timeline.
export async function deleteNote(slug: string, id: number) {
  const db = await getDb();
  const res = await db.execute({ sql: "DELETE FROM site_events WHERE client_slug = ? AND id = ? AND kind = 'note'", args: [slug, id] });
  return res.rowsAffected > 0;
}

// One-time: work done before the timeline existed (tasks marked done, feedback
// resolved) so the charts have history from day one.
export async function backfillEvents(slug: string) {
  const db = await getDb();
  const marker = await db.execute({
    sql: "SELECT 1 FROM analytics_cache WHERE client_slug = ? AND metric_type = 'events_backfill'",
    args: [slug],
  });
  if (marker.rows.length) return;

  const tasks = await db.execute({
    sql: "SELECT task_key, task, status, updated_at FROM agent_tasks WHERE client_slug = ? AND status IN ('done', 'applied')",
    args: [slug],
  });
  for (const t of tasks.rows) {
    const task = JSON.parse(t.task as string) as { title: string; path?: string; type: string };
    if (task.type === "client_feedback") continue; // comes from the feedback table below
    await addEvent(slug, {
      kind: "agent_task",
      title: task.title,
      pages: task.path ? [task.path] : [],
      source: "Agents",
      ref: `task:${t.task_key}`,
      occurredAt: t.updated_at as string,
    });
  }
  const resolved = await db.execute({
    sql: "SELECT id, page_path, body, updated_at FROM feedback WHERE client_slug = ? AND status = 'resolved' AND kind = 'comment'",
    args: [slug],
  });
  for (const f of resolved.rows) {
    await addEvent(slug, {
      kind: "feedback_resolved",
      title: `Client feedback resolved: “${String(f.body).slice(0, 80)}”`,
      pages: [f.page_path as string],
      source: "Client feedback",
      ref: `feedback:${f.id}`,
      occurredAt: f.updated_at as string,
    });
  }
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
          VALUES (?, 'events_backfill', 'all', '{}', datetime('now'))`,
    args: [slug],
  });
}

// Google's own list of ranking updates (core, spam, etc.) from the Search
// Status Dashboard, cached a day. Shown on every client's charts so a
// sitewide jump or drop isn't credited to our own work.
export async function googleUpdates(): Promise<SiteEvent[]> {
  const db = await getDb();
  const cached = await db.execute(
    "SELECT data FROM analytics_cache WHERE client_slug = '_global' AND metric_type = 'google_updates' AND fetched_at > datetime('now', '-24 hours')"
  );
  let items: { id: string; begin: string; end?: string; external_desc: string; affected_products?: { title: string }[] }[] = [];
  if (cached.rows[0]) {
    items = JSON.parse(cached.rows[0].data as string);
  } else {
    try {
      const res = await fetch("https://status.search.google.com/incidents.json", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        items = await res.json();
        await db.execute({
          sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
                VALUES ('_global', 'google_updates', 'all', ?, datetime('now'))`,
          args: [JSON.stringify(items)],
        });
      }
    } catch { /* the markers just won't include Google updates */ }
  }
  return items
    .filter((i) => (i.affected_products || []).some((p) => /ranking/i.test(p.title)))
    .map((i) => ({
      id: `google:${i.id}`,
      occurredAt: i.begin,
      day: dayOf(i.begin),
      kind: "google_update" as const,
      title: `Google: ${i.external_desc}`,
      detail: i.end ? `Rollout ${dayOf(i.begin)} to ${dayOf(i.end)}` : "Rolling out",
      pages: [],
      source: "Google Search Status",
      ref: `google:${i.id}`,
      manual: false,
    }));
}
