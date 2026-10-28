"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, Check, Eye, EyeOff, ExternalLink, Link2, Loader2, Pencil, RefreshCw, Save,
} from "lucide-react";
import type { PortalChange, PortalReport, PortalSettings, PortalWin } from "@/lib/portal";

// The team's controls for a client's progress page: share it or not, the lead
// value behind the revenue line, when the engagement started, and which wins
// and changes the client sees (and in what words).

interface PortalData {
  enabled: boolean;
  token: string;
  settings: PortalSettings;
  report: PortalReport | null;
}

const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const card = "rounded-2xl border border-border bg-white p-5 md:p-6";
const dayLabel = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function ClientPortal({ clientSlug, clientName }: { clientSlug: string; clientName: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ startedAt: "", leadValue: "" });
  const [savedForm, setSavedForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", why: "" });

  function load(fresh = false) {
    return fetch(`/api/portal?client=${clientSlug}&report=1${fresh ? "&fresh=1" : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: PortalData) => {
        if (!json.token) return;
        setData(json);
        setForm({ startedAt: json.settings.startedAt || "", leadValue: json.settings.leadValue ? String(json.settings.leadValue) : "" });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [clientSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(body: Record<string, unknown>, reload: "report" | "fresh" | "none" = "report") {
    const res = await fetch("/api/portal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: clientSlug, ...body }) });
    const json = await res.json();
    if (reload === "none") setData((d) => (d ? { ...d, enabled: json.enabled, token: json.token, settings: json.settings } : d));
    else await load(reload === "fresh");
  }

  async function toggleShare() {
    if (!data) return;
    setBusy("share");
    await patch({ enabled: !data.enabled }, "none");
    setBusy(null);
  }
  async function newLink() {
    if (!confirm(`Create a new link for ${clientName}? The current link stops working right away.`)) return;
    setBusy("link");
    await patch({ rotate: true }, "none");
    setBusy(null);
  }
  async function saveSettings() {
    setBusy("settings");
    const startChanged = form.startedAt !== (data?.settings.startedAt || "");
    await patch({ settings: { startedAt: form.startedAt || null, leadValue: form.leadValue ? Number(form.leadValue.replace(/[^0-9.]/g, "")) : null } }, startChanged ? "fresh" : "report");
    setBusy(null);
    setSavedForm(true);
    setTimeout(() => setSavedForm(false), 1500);
  }
  async function toggleHidden(key: string, hidden: boolean) {
    setBusy(key);
    await patch({ hide: { key, hidden } });
    setBusy(null);
  }
  async function saveOverride(key: string, reset = false) {
    setBusy(key);
    await patch({ override: reset ? { key } : { key, title: draft.title, why: draft.why } });
    setBusy(null);
    setEditing(null);
  }
  async function refresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  if (loading) {
    return <div className="py-24 flex justify-center text-muted-foreground"><Loader2 size={22} className="animate-spin text-[#0CA4C3]" /></div>;
  }
  if (!data) return <p className="text-muted-foreground">Couldn&apos;t load the client page settings.</p>;

  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/progress/${data.token}`;
  const report = data.report;
  const failed = report?.sources.filter((s) => !s.ok) || [];

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0394B2] mb-1.5">Client page</div>
          <h2 className="font-headline text-[28px] text-[#001A2E]">What {clientName} sees</h2>
          <p className="mt-1 max-w-[720px] text-[15px] text-muted-foreground">
            A private progress page for {clientName}: results in plain language, the work behind them, and their requests. Wins and changes fill in automatically; hide or reword anything before you share it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-[14px] font-medium hover:bg-muted/50">
            {data.enabled ? "Open page" : "Preview"} <ExternalLink size={13} />
          </a>
          <button
            onClick={toggleShare}
            disabled={busy === "share"}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[14px] font-semibold ${data.enabled ? "border border-border bg-white text-[#001A2E] hover:bg-muted/50" : "bg-[#0CA4C3] text-white hover:bg-[#0394B2]"}`}
          >
            {busy === "share" ? <Loader2 size={14} className="animate-spin" /> : data.enabled ? <EyeOff size={14} /> : <Eye size={14} />}
            {data.enabled ? "Stop sharing" : "Share with client"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px] items-start">
        <div className="space-y-6 min-w-0">
          {/* Link */}
          <div className={card}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className={eyebrow}>Private link</div>
              <span className={`text-[12px] font-semibold rounded-full px-2.5 py-0.5 ${data.enabled ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                {data.enabled ? "Shared: works for anyone with the link" : "Not shared: only your team can open it"}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <input readOnly value={link} className="flex-1 min-w-[240px] rounded-lg border border-border bg-[#F7FAFB] px-3 py-2 text-[14px] text-[#001A2E]" onFocus={(e) => e.currentTarget.select()} />
              <button
                onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#001A2E] px-3.5 py-2 text-[14px] font-semibold text-white hover:bg-[#01384C]"
              >
                {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={newLink} disabled={busy === "link"} title="Replace the link (the old one stops working)" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[14px] text-muted-foreground hover:bg-muted/50">
                <RefreshCw size={14} className={busy === "link" ? "animate-spin" : ""} /> New link
              </button>
            </div>
            <p className="mt-2.5 text-[13px] text-muted-foreground">
              The page never shows visitor names, companies, or anything from Lead Funnel. Its &ldquo;Comment on your site&rdquo; button opens their review link.
            </p>
          </div>

          {/* Wins */}
          <ItemList
            title="Wins"
            note="Found automatically: keywords reaching page one or the top 3, record weeks, AI mentions, new pages, and changes that paid off."
            empty="No wins yet. They appear here as rankings and traffic move."
            items={report?.wins || []}
            busy={busy}
            onToggle={toggleHidden}
          />

          {/* Changes */}
          <div className={card}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <h3 className="font-headline text-[22px] text-[#001A2E]">What we did</h3>
              <span className="text-[13px] text-muted-foreground">{report?.changes.filter((c) => !c.hidden).length || 0} shown</span>
            </div>
            <p className="text-[13.5px] text-muted-foreground mb-4">
              From the change timeline: Agents tasks marked done or published, new pages, and resolved client requests. Results only show when clicks went up; you see the full before/after on the Overview.
            </p>
            {!report?.changes.length ? (
              <p className="text-[14px] text-muted-foreground">Nothing logged yet. Mark Agents tasks done or publish a change and it shows up here.</p>
            ) : (
              <div className="divide-y divide-border">
                {report.changes.map((c) => (
                  <ChangeRow
                    key={c.key}
                    c={c}
                    busy={busy === c.key}
                    editing={editing === c.key}
                    draft={draft}
                    setDraft={setDraft}
                    onEdit={() => { setEditing(c.key); setDraft({ title: c.title, why: c.why || "" }); }}
                    onCancel={() => setEditing(null)}
                    onSave={() => saveOverride(c.key)}
                    onReset={() => saveOverride(c.key, true)}
                    onToggle={() => toggleHidden(c.key, !c.hidden)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Settings column */}
        <div className="space-y-6">
          <div className={card}>
            <div className={`${eyebrow} mb-3`}>Page settings</div>
            <label className="block text-[14px] font-medium text-[#001A2E]">Working together since</label>
            <input type="date" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.target.value })} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-[14px]" />
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Powers &ldquo;Since we started.&rdquo; {report && !data.settings.startedAt ? `Currently ${dayLabel(report.startedAt)}, from the ClickUp start date or the first logged change.` : ""}
            </p>

            <label className="block text-[14px] font-medium text-[#001A2E] mt-4">Average value of a new lead ($)</label>
            <input inputMode="numeric" placeholder="e.g. 900" value={form.leadValue} onChange={(e) => setForm({ ...form, leadValue: e.target.value })} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-[14px]" />
            <p className="mt-1 text-[12.5px] text-muted-foreground">Shows &ldquo;≈ $X in potential revenue from new leads.&rdquo; Leave empty to hide the line. Use a number the client gave you.</p>

            <button onClick={saveSettings} disabled={busy === "settings"} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3.5 py-2 text-[14px] font-semibold text-white hover:bg-[#0394B2]">
              {busy === "settings" ? <Loader2 size={14} className="animate-spin" /> : savedForm ? <Check size={14} /> : <Save size={14} />} {savedForm ? "Saved" : "Save"}
            </button>
          </div>

          <div className={card}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className={eyebrow}>Data</div>
              <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0394B2] hover:underline">
                <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh now
              </button>
            </div>
            <p className="text-[13.5px] text-muted-foreground">
              Rebuilt every 6 hours{report ? `; last built ${new Date(report.generatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.
            </p>
            {failed.length > 0 && (
              <div className="mt-3 space-y-2">
                {failed.map((s) => (
                  <div key={s.name} className="flex gap-2 text-[13px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span><b>{s.name}:</b> {s.note || "Couldn't load"}. That section is left off the page.</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemList({ title, note, empty, items, busy, onToggle }: {
  title: string; note: string; empty: string; items: PortalWin[]; busy: string | null; onToggle: (key: string, hidden: boolean) => void;
}) {
  return (
    <div className={card}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h3 className="font-headline text-[22px] text-[#001A2E]">{title}</h3>
        <span className="text-[13px] text-muted-foreground">{items.filter((i) => !i.hidden).length} shown</span>
      </div>
      <p className="text-[13.5px] text-muted-foreground mb-4">{note}</p>
      {!items.length ? <p className="text-[14px] text-muted-foreground">{empty}</p> : (
        <div className="divide-y divide-border">
          {items.map((w) => (
            <div key={w.key} className={`flex gap-3 items-start py-3 ${w.hidden ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-medium text-[#001A2E]">{w.title}</p>
                <p className="text-[13px] text-muted-foreground">{w.detail} · {dayLabel(w.day)}</p>
              </div>
              <HideButton hidden={!!w.hidden} busy={busy === w.key} onClick={() => onToggle(w.key, !w.hidden)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HideButton({ hidden, busy, onClick }: { hidden: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-muted/50" title={hidden ? "Show this to the client" : "Hide this from the client"}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      {hidden ? "Hidden" : "Shown"}
    </button>
  );
}

function ChangeRow({ c, busy, editing, draft, setDraft, onEdit, onCancel, onSave, onReset, onToggle }: {
  c: PortalChange; busy: boolean; editing: boolean; draft: { title: string; why: string };
  setDraft: (d: { title: string; why: string }) => void;
  onEdit: () => void; onCancel: () => void; onSave: () => void; onReset: () => void; onToggle: () => void;
}) {
  if (editing) {
    return (
      <div className="py-3 space-y-2">
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full rounded-lg border border-border px-3 py-2 text-[14px] font-medium text-[#001A2E]" placeholder="What we did, in the client's words" />
        <textarea value={draft.why} onChange={(e) => setDraft({ ...draft, why: e.target.value })} rows={3} className="w-full rounded-lg border border-border px-3 py-2 text-[14px]" placeholder="Why we did it" />
        <div className="flex gap-2 flex-wrap">
          <button onClick={onSave} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#0394B2]">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save wording
          </button>
          <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted/50">Cancel</button>
          {c.edited && <button onClick={onReset} disabled={busy} className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:underline">Reset to automatic</button>}
        </div>
      </div>
    );
  }
  return (
    <div className={`flex gap-3 items-start py-3 ${c.hidden ? "opacity-50" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-medium text-[#001A2E]">
          {c.title}
          {c.edited && <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0394B2]">Edited</span>}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {dayLabel(c.day)}{c.why ? ` · Why: ${c.why}` : " · No reason given yet"}
        </p>
        {c.result && <p className={`text-[12.5px] mt-0.5 font-medium ${c.result.tone === "good" ? "text-emerald-700" : "text-[#0394B2]"}`}>{c.result.text}</p>}
      </div>
      <button onClick={onEdit} className="shrink-0 p-2 rounded-lg text-muted-foreground hover:bg-muted/50" title="Reword for the client"><Pencil size={14} /></button>
      <HideButton hidden={!!c.hidden} busy={busy} onClick={onToggle} />
    </div>
  );
}
