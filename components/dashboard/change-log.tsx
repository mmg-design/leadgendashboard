"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History, Loader2, Plus, Trash2, X } from "lucide-react";
import type { EventKind, SiteEvent } from "@/lib/site-events";
import { ImpactChip, KIND_META, reloadSiteEvents, useSiteEvents } from "./change-markers";

// "Changes & what moved": the client's change timeline for the selected
// window, each change with its before/after Google search numbers, plus notes
// for changes the dashboard can't see (ads launched, phone number changed...).

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const today = () => new Date().toLocaleDateString("en-CA");

export function ChangeLog({ clientSlug, range }: { clientSlug: string; range: string }) {
  const { events, loaded } = useSiteEvents(clientSlug);
  const [kind, setKind] = useState<EventKind | "all">("all");
  const [showGoogle, setShowGoogle] = useState(true);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState({ day: today(), title: "", page: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mountedAt] = useState(() => Date.now());

  // A little wider than the chart window, so changes that explain the start of
  // the period are still listed.
  const since = new Date(mountedAt - ((RANGE_DAYS[range] || 30) + 14) * 86_400_000).toLocaleDateString("en-CA");
  const inRange = events.filter((e) => e.day >= since && (showGoogle || e.kind !== "google_update"));
  const kinds = [...new Set(inRange.map((e) => e.kind))];
  const shown = inRange.filter((e) => kind === "all" || e.kind === kind);

  async function saveNote() {
    setBusy(true); setError(null);
    const res = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: clientSlug, ...note }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "Couldn't save the note.");
    setNote({ day: today(), title: "", page: "" });
    setAdding(false);
    reloadSiteEvents(clientSlug);
  }
  async function removeNote(e: SiteEvent) {
    if (!confirm("Remove this note from the timeline?")) return;
    await fetch(`/api/events?client=${clientSlug}&id=${e.id}`, { method: "DELETE" });
    reloadSiteEvents(clientSlug);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <History size={16} className="text-[#097388]/75" />
          <CardTitle className="text-[22px] font-headline font-normal text-[#001A2E]">Changes &amp; what moved</CardTitle>
          <button onClick={() => setAdding(!adding)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] font-medium hover:bg-muted/50">
            {adding ? <X size={13} /> : <Plus size={13} />} {adding ? "Cancel" : "Add note"}
          </button>
        </div>
        <p className="text-[14px] text-muted-foreground">
          Everything that changed on the site, matched to the vertical lines on the charts. Impact compares Google clicks for the changed page 14 days before and after, next to the whole site.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-muted/30 p-3">
            <label className="text-[12px] text-muted-foreground">Date<input type="date" value={note.day} max={today()} onChange={(e) => setNote({ ...note, day: e.target.value })} className="mt-1 block rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px] text-[#001A2E]" /></label>
            <label className="flex-1 min-w-[220px] text-[12px] text-muted-foreground">What changed<input value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} placeholder="e.g. Launched Google Ads, new phone number" className="mt-1 block w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px] text-[#001A2E]" /></label>
            <label className="w-[180px] text-[12px] text-muted-foreground">Page (optional)<input value={note.page} onChange={(e) => setNote({ ...note, page: e.target.value })} placeholder="/services" className="mt-1 block w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px] text-[#001A2E]" /></label>
            <button onClick={saveNote} disabled={busy || !note.title.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#0394B2] disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add to timeline
            </button>
            {error && <p className="w-full text-[12px] text-red-600">{error}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", ...kinds] as const).map((k) => {
            const meta = k === "all" ? null : KIND_META[k];
            return (
              <button key={k} onClick={() => setKind(k)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${kind === k ? "border-[#001A2E]/30 bg-white text-[#001A2E]" : "border-border text-muted-foreground hover:text-[#001A2E]"}`}>
                {meta && <span className="size-2 rounded-full" style={{ background: meta.color }} />}
                {meta ? meta.label : `All (${inRange.length})`}
              </button>
            );
          })}
          <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={showGoogle} onChange={(e) => setShowGoogle(e.target.checked)} /> Google updates
          </label>
        </div>

        {!loaded ? (
          <div className="py-6 flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Loading changes…</div>
        ) : shown.length === 0 ? (
          <p className="py-4 text-[14px] text-muted-foreground">
            No changes in this window yet. Finished Agents tasks, new pages in the sitemap, Webflow publishes, and resolved client feedback show up here automatically.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            {shown.map((e) => {
              const meta = KIND_META[e.kind];
              return (
                <div key={String(e.id)} className="flex gap-3 py-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}1f` }}>
                    <meta.Icon size={15} style={{ color: meta.color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
                      <span className="font-semibold text-[#001A2E]">{new Date(`${e.day}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                      <span className="text-muted-foreground">{meta.label}</span>
                      {e.pages.length > 1 && <span className="text-muted-foreground">· {e.pages.length} pages</span>}
                    </div>
                    <p className="text-[14.5px] leading-snug text-[#001A2E]">{e.title}</p>
                    {e.detail && e.kind !== "sitemap" && <p className="text-[12.5px] text-muted-foreground">{e.detail}</p>}
                    <div className="mt-1"><ImpactChip clientSlug={clientSlug} event={e} /></div>
                  </div>
                  {e.manual && (
                    <button onClick={() => removeNote(e)} title="Remove note" className="self-start p-1.5 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-red-600"><Trash2 size={13} /></button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
