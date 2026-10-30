"use client";

import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { ReferenceLine } from "recharts";
import {
  Bot, FilePen, FilePlus2, FileMinus2, Globe, Loader2, Map as MapIcon, MessageSquare, PencilLine, Rocket, Sparkles,
} from "lucide-react";
import type { EventKind, SiteEvent } from "@/lib/site-events";
import type { EventImpact } from "@/lib/event-impact";

// Change markers shared by every chart: the client's change timeline (Agents
// work, new pages, publishes, resolved feedback, notes) plus Google ranking
// updates, loaded once per client and drawn as vertical lines.

export const KIND_META: Record<EventKind, { label: string; color: string; Icon: typeof Bot }> = {
  agent_task: { label: "Agents task done", color: "#1baf7a", Icon: Bot },
  published: { label: "Published by an agent", color: "#2a78d6", Icon: Rocket },
  page_added: { label: "New page", color: "#4a3aa7", Icon: FilePlus2 },
  page_updated: { label: "Pages updated", color: "#0CA4C3", Icon: FilePen },
  page_removed: { label: "Page removed", color: "#e34948", Icon: FileMinus2 },
  site_published: { label: "Webflow publish", color: "#eda100", Icon: Globe },
  feedback_resolved: { label: "Client feedback resolved", color: "#e87ba4", Icon: MessageSquare },
  sitemap: { label: "Sitemap resubmitted", color: "#eb6834", Icon: MapIcon },
  note: { label: "Note", color: "#001A2E", Icon: PencilLine },
  google_update: { label: "Google update", color: "#94a3b8", Icon: Sparkles },
};

// ── Shared store: one fetch per client, every chart subscribes ─────────────

type Snapshot = { events: SiteEvent[]; loaded: boolean };
const EMPTY: Snapshot = { events: [], loaded: false };
const stores = new Map<string, { snap: Snapshot; listeners: Set<() => void>; inflight?: Promise<void> }>();

function storeFor(slug: string) {
  let s = stores.get(slug);
  if (!s) { s = { snap: EMPTY, listeners: new Set() }; stores.set(slug, s); }
  return s;
}

export function reloadSiteEvents(slug: string) {
  const s = storeFor(slug);
  s.inflight = fetch(`/api/events?client=${slug}`, { cache: "no-store" })
    .then((r) => r.json())
    .then((d: { events?: SiteEvent[]; google?: SiteEvent[] }) => {
      s.snap = { events: [...(d.events || []), ...(d.google || [])].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)), loaded: true };
    })
    .catch(() => { s.snap = { ...s.snap, loaded: true }; })
    .finally(() => { s.inflight = undefined; s.listeners.forEach((l) => l()); });
  return s.inflight;
}

export function useSiteEvents(slug: string): Snapshot {
  const snap = useSyncExternalStore(
    (cb) => { const s = storeFor(slug); s.listeners.add(cb); return () => { s.listeners.delete(cb); }; },
    () => storeFor(slug).snap,
    () => EMPTY
  );
  useEffect(() => {
    if (!slug) return;
    const s = storeFor(slug);
    if (!s.snap.loaded && !s.inflight) reloadSiteEvents(slug);
  }, [slug]);
  return snap;
}

export function eventsByDay(events: SiteEvent[]) {
  const m = new Map<string, SiteEvent[]>();
  for (const e of events) m.set(e.day, [...(m.get(e.day) || []), e]);
  return m;
}

// ── Chart markers ──────────────────────────────────────────────────────────

export type ActiveMarker = { day: string; x: number; width: number } | null;

function Flag(props: { viewBox?: { x: number; y: number }; items: SiteEvent[]; day: string; onEnter: (m: ActiveMarker) => void }) {
  const { viewBox, items, day, onEnter } = props;
  if (!viewBox) return null;
  const color = items.length === 1 ? KIND_META[items[0].kind].color : "#001A2E";
  return (
    <g
      style={{ cursor: "pointer" }}
      onMouseEnter={(e) => onEnter({ day, x: viewBox.x, width: e.currentTarget.ownerSVGElement?.clientWidth || 800 })}
      onClick={(e) => onEnter({ day, x: viewBox.x, width: e.currentTarget.ownerSVGElement?.clientWidth || 800 })}
    >
      <circle cx={viewBox.x} cy={viewBox.y + 9} r={9} fill={color} stroke="#fff" strokeWidth={2} />
      <text x={viewBox.x} y={viewBox.y + 13} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
        {items.length > 1 ? items.length : "•"}
      </text>
    </g>
  );
}

// Reference lines for every day in the chart that has changes. `xFor` maps an
// event day (YYYY-MM-DD) to that chart's x value, or null when it's out of range.
export function changeMarkerLines(events: SiteEvent[], xFor: (day: string) => string | null, onEnter: (m: ActiveMarker) => void): ReactElement[] {
  return [...eventsByDay(events)].flatMap(([day, items]) => {
    const x = xFor(day);
    if (!x) return [];
    const onlyGoogle = items.every((i) => i.kind === "google_update");
    return [
      <ReferenceLine
        key={`chg-${day}`}
        x={x}
        stroke={onlyGoogle ? "#94a3b8" : items.length === 1 ? KIND_META[items[0].kind].color : "#001A2E"}
        strokeOpacity={0.55}
        strokeDasharray={onlyGoogle ? "2 4" : "4 3"}
        ifOverflow="extendDomain"
        label={<Flag items={items} day={day} onEnter={onEnter} />}
      />,
    ];
  });
}

// Hover card for a marker, positioned over the chart at the marker's x.
export function MarkerCard({ clientSlug, active, events, onClose }: {
  clientSlug: string; active: ActiveMarker; events: SiteEvent[]; onClose: () => void;
}) {
  if (!active) return null;
  const width = active.width;
  const items = events.filter((e) => e.day === active.day);
  if (!items.length) return null;
  const left = Math.min(Math.max(8, active.x - 150), Math.max(8, width - 312));
  return (
    <div className="absolute z-30 top-6 w-[300px] rounded-xl border border-border bg-white p-3 shadow-[0_12px_40px_rgba(0,26,46,0.16)]" style={{ left }} onMouseLeave={onClose}>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {new Date(`${active.day}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
      </p>
      <div className="space-y-2.5 max-h-[260px] overflow-y-auto">
        {items.map((e) => <EventLine key={String(e.id)} clientSlug={clientSlug} e={e} />)}
      </div>
    </div>
  );
}

function EventLine({ clientSlug, e }: { clientSlug: string; e: SiteEvent }) {
  const meta = KIND_META[e.kind];
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full" style={{ background: `${meta.color}22` }}>
        <meta.Icon size={11} style={{ color: meta.color }} />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-snug text-[#001A2E]">{e.title}</p>
        <p className="text-[11.5px] text-muted-foreground">{meta.label}{e.pages.length === 1 && !e.title.includes(e.pages[0]) ? ` · ${e.pages[0]}` : ""}</p>
        <ImpactChip clientSlug={clientSlug} event={e} compact />
      </div>
    </div>
  );
}

// ── Impact ─────────────────────────────────────────────────────────────────

const impactCache = new Map<string, Promise<EventImpact | null>>();

function loadImpact(slug: string, id: SiteEvent["id"]) {
  const key = `${slug}:${id}`;
  if (!impactCache.has(key)) {
    impactCache.set(key, fetch(`/api/events/impact?client=${slug}&id=${encodeURIComponent(String(id))}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return impactCache.get(key)!;
}

const signed = (n: number | null | undefined, unit = "%") => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}${unit}`);

export function ImpactChip({ clientSlug, event, compact }: { clientSlug: string; event: SiteEvent; compact?: boolean }) {
  const [impact, setImpact] = useState<EventImpact | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadImpact(clientSlug, event.id).then((i) => { if (alive) setImpact(i); });
    return () => { alive = false; };
  }, [clientSlug, event.id]);

  const base = compact ? "mt-1 text-[11.5px]" : "text-[12.5px]";
  if (impact === undefined) return <span className={`${base} inline-flex items-center gap-1 text-muted-foreground`}><Loader2 size={11} className="animate-spin" /> Measuring impact…</span>;
  if (!impact || impact.status === "no_data") return <span className={`${base} text-muted-foreground`}>Not enough search data to measure</span>;
  if (impact.status === "not_connected") return <span className={`${base} text-muted-foreground`}>Connect Search Console to measure impact</span>;
  if (impact.status === "measuring") return <span className={`${base} text-muted-foreground`}>Measuring · day {impact.daysAfter} of {impact.window}</span>;

  const c = impact.change!;
  const good = (c.clicksPct ?? 0) > (impact.site?.clicksPct ?? 0);
  return (
    <span className={`${base} inline-flex flex-wrap items-center gap-x-2 gap-y-0.5`}>
      <span className={`font-semibold ${good ? "text-emerald-700" : (c.clicksPct ?? 0) < 0 ? "text-[#B42318]" : "text-[#001A2E]"}`}>
        Clicks {signed(c.clicksPct)}
      </span>
      {impact.scope === "page" && <span className="text-muted-foreground">site {signed(impact.site?.clicksPct)}</span>}
      <span className="text-muted-foreground">CTR {signed(c.ctrPts, " pts")}</span>
      {impact.before?.position != null && impact.after?.position != null && (
        <span className={c.position != null && c.position > 0.5 ? "text-emerald-700" : c.position != null && c.position < -0.5 ? "text-[#B42318]" : "text-muted-foreground"} title="Average Google position (lower is better)">
          Position {impact.before.position} → {impact.after.position}
        </span>
      )}
      {!compact && <span className="text-muted-foreground">· {impact.scope === "page" ? "this page" : "whole site"}, {impact.window} days before vs {impact.daysAfter} after</span>}
      {!compact && impact.overlaps.length > 0 && (
        <span className="text-amber-700" title={impact.overlaps.join("\n")}>· {impact.overlaps.length} other change{impact.overlaps.length === 1 ? "" : "s"} the same week</span>
      )}
    </span>
  );
}

