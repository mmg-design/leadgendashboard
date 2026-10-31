"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ChevronDown, Clock, ExternalLink, Info, Loader2, Pencil, Sparkles, Terminal, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/dashboard/agents";
import { EFFORT_LABEL, KIND_LABEL, PROFILE_FIELDS, STAGE_LABEL, type LinkProfile, type Stage } from "@/lib/link-prospect-labels";
import type { LinkProspect } from "@/lib/link-prospects";

// The Links tab's prospect list: sites worth a link for this client, easiest
// first, each with the page where the next step happens and a pitch ready to
// copy. Research runs in Claude Code (/link-prospects), on the Claude plan.

const GREEN = "#008300";
const SHOWN = 5;
const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const btnSecondary = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[14px] font-medium text-[#001A2E] hover:bg-muted/50 disabled:opacity-50 transition-colors";
const btnGhost = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[14px] font-medium text-muted-foreground hover:text-[#001A2E] hover:bg-muted/50 disabled:opacity-50 transition-colors";
const WORKING_STAGES: Stage[] = ["not_started", "in_progress", "follow_up", "completed"];
const STAGE_STYLE: Record<Stage, string> = {
  not_started: "border-border bg-white text-[#001A2E]",
  in_progress: "border-[#0CA4C3]/40 bg-[#0CA4C3]/[0.08] text-[#01384C]",
  follow_up: "border-amber-300 bg-amber-50 text-amber-800",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-800",
  dismissed: "border-border bg-muted text-muted-foreground",
};
const EFFORT_STYLE = { easy: "bg-[#008300]/10 text-[#006400]", medium: "bg-[#001A2E]/[0.07] text-[#001A2E]", hard: "bg-muted text-muted-foreground" };

const sortByPriority = (list: LinkProspect[]) => [...list].sort((a, b) => b.priority - a.priority);
const shortDate = (s: string) => new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`).toLocaleDateString([], { month: "short", day: "numeric" });

function Text({ title, text, copy = true }: { title: string; text: string; copy?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-[#001A2E]">{title}</p>
        {copy && <CopyButton text={text} />}
      </div>
      <p className="mt-1 whitespace-pre-line text-[13px] text-[#001A2E]/85">{text}</p>
    </div>
  );
}

function ProspectRow({ p, rank, onStage, onNotes }: { p: LinkProspect; rank: number | null; onStage: (s: Stage) => void; onNotes: (n: string) => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(p.notes);
  const isForm = !p.pitchSubject && !!p.pitchBody;
  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5">
        <span className="mt-0.5 w-5 shrink-0 text-right text-[14px] font-semibold tabular-nums text-muted-foreground">{rank ?? ""}</span>
        <button className="min-w-[220px] flex-1 text-left" onClick={() => setOpen(!open)}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] font-semibold text-[#001A2E]">{p.name}</span>
            <span className="text-[13px] text-muted-foreground">{p.domain}</span>
            {p.followUpDue && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-800"><Clock size={11} /> Follow up</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${EFFORT_STYLE[p.effort]}`}>{EFFORT_LABEL[p.effort]}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[#001A2E]/80">{KIND_LABEL[p.kind]}</span>
            <span className="text-muted-foreground">authority {p.authority}</span>
          </div>
          <p className="mt-1.5 text-[14px] text-[#001A2E]/75">{p.why}</p>
        </button>
        <div className="flex shrink-0 items-center gap-2 pl-9 sm:pl-0">
          <a href={p.nextStepUrl} target="_blank" rel="noreferrer" className={btnSecondary} title={p.nextStepUrl}>
            {p.nextStepLabel} <ExternalLink size={13} className="opacity-60" />
          </a>
          <select
            aria-label={`Stage for ${p.name}`}
            value={p.stage}
            onChange={(e) => onStage(e.target.value as Stage)}
            className={`rounded-lg border px-2.5 py-2 text-[14px] font-medium ${STAGE_STYLE[p.stage]}`}
          >
            {WORKING_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            {p.stage === "dismissed" && <option value="dismissed">Dismissed</option>}
          </select>
          <button className={btnGhost} onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
            <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3 pl-9">
          <div className="grid gap-x-6 gap-y-1 text-[13px] text-[#001A2E]/80 sm:grid-cols-2">
            <p><span className="text-muted-foreground">Link to:</span> {p.targetPage}</p>
            {p.contact && <p><span className="text-muted-foreground">Contact:</span> {p.contact}</p>}
            <p className="truncate"><span className="text-muted-foreground">Next step:</span> <a href={p.nextStepUrl} target="_blank" rel="noreferrer" className="text-[#0394B2] hover:underline">{p.nextStepUrl}</a>{p.nextStepStatus === null ? " (didn't load when checked)" : p.nextStepStatus >= 500 ? ` (returned ${p.nextStepStatus} when checked)` : ""}</p>
            <p><span className="text-muted-foreground">{STAGE_LABEL[p.stage]} since</span> {shortDate(p.stageChangedAt)}</p>
          </div>
          {p.pitchBody && <Text title={isForm ? "What to put in the form" : `Subject: ${p.pitchSubject}`} text={isForm ? p.pitchBody : `Subject: ${p.pitchSubject}\n\n${p.pitchBody}`} />}
          {p.followUp && <Text title="Follow-up, 5 to 7 days later if no reply" text={p.followUp} />}
          <div>
            <p className={`${eyebrow} mb-1`}>Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== p.notes && onNotes(notes)}
              rows={2}
              placeholder="Who you spoke to, what they said, dates…"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px] text-[#001A2E] placeholder:text-muted-foreground/70"
            />
          </div>
          {p.stage !== "dismissed" ? (
            <button className={btnGhost} onClick={() => onStage("dismissed")}><X size={14} /> Not a fit, don&apos;t suggest it again</button>
          ) : (
            <button className={btnGhost} onClick={() => onStage("not_started")}>Restore</button>
          )}
        </div>
      )}
    </li>
  );
}

function ProfileCard({ clientSlug, profile, onSaved }: { clientSlug: string; profile: LinkProfile | null; onSaved: (p: LinkProfile) => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function edit() {
    setDraft(Object.fromEntries(PROFILE_FIELDS.map(({ key }) => [key, profile?.[key] || ""])));
    setEditing(true); setOpen(true);
  }
  async function save() {
    setSaving(true);
    const res = await fetch("/api/link-prospects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: clientSlug, profile: draft }) }).then((r) => r.json()).catch(() => null);
    setSaving(false);
    if (res?.profile) { onSaved(res.profile); setEditing(false); }
  }

  return (
    <div className="rounded-xl border border-border/70">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)}>
          <p className="text-[15px] font-semibold text-[#001A2E]">Company profile</p>
          <p className="text-[13px] text-muted-foreground">
            {!profile ? "Claude drafts it from the website on the first research run." : profile.updatedBy === "Team" ? `Edited by your team ${shortDate(profile.updatedAt)}. Research follows it as written.` : `Drafted by Claude ${shortDate(profile.updatedAt)}. Edit anything it got wrong or doesn't know.`}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {editing ? (
            <>
              <button className={btnGhost} onClick={() => setEditing(false)}>Cancel</button>
              <button className={btnSecondary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />} Save</button>
            </>
          ) : (
            <button className={btnGhost} onClick={edit}><Pencil size={14} /> Edit</button>
          )}
          {!editing && (
            <button className={btnGhost} onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
              <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="grid gap-4 border-t border-border/60 px-4 py-4 md:grid-cols-2">
          {PROFILE_FIELDS.map(({ key, label, hint }) => (
            <div key={key}>
              <p className={eyebrow}>{label}</p>
              {editing ? (
                <textarea
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  rows={key === "pages" || key === "relationships" ? 5 : 3}
                  placeholder={hint}
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px] text-[#001A2E] placeholder:text-muted-foreground/70"
                />
              ) : (
                <p className="mt-1 whitespace-pre-line text-[14px] text-[#001A2E]/85">{profile?.[key] || <span className="text-muted-foreground">{hint}</span>}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// How new prospects get added. Research runs in the Claude app on the team's
// Claude plan, so it can't be started from this page; this says how.
function HowToRefresh({ command }: { command: string }) {
  return (
    <div className="relative group/how">
      <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-[#0394B2] hover:bg-[#0CA4C3]/10">
        <Info size={13} /> How to get more
      </button>
      <div className="invisible absolute right-0 top-full z-50 w-[360px] max-w-[calc(100vw-32px)] pt-2 opacity-0 transition-all duration-150 group-hover/how:visible group-hover/how:opacity-100 group-focus-within/how:visible group-focus-within/how:opacity-100">
        <div className="space-y-3 rounded-xl bg-[#001A2E] px-4 py-3.5 text-[13px] leading-relaxed text-white shadow-lg">
          <p className="font-semibold">How new prospects get added</p>
          <div className="flex gap-2.5">
            <CalendarClock size={15} className="mt-0.5 shrink-0 text-[#5FD3EA]" />
            <p><span className="font-semibold">Automatically, every Monday at 8am.</span> Claude researches every client with fewer than 15 left to start. The Claude app needs to be open on the Mac it&apos;s set up on; if it&apos;s closed, the run happens next time it opens.</p>
          </div>
          <div className="flex gap-2.5">
            <Terminal size={15} className="mt-0.5 shrink-0 text-[#5FD3EA]" />
            <div>
              <p><span className="font-semibold">Right now:</span> open the Claude app, go to <span className="font-semibold">Code</span>, start a new session and send:</p>
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white/10 px-2.5 py-1.5">
                <code className="text-[13px]">{command}</code>
                <span className="[&_button]:text-[#5FD3EA] [&_button:hover]:bg-white/10"><CopyButton text={command} /></span>
              </div>
              <p className="mt-1.5 text-white/70">It takes about 10 minutes. Reload this page when Claude says it&apos;s done.</p>
            </div>
          </div>
          <p className="border-t border-white/15 pt-2.5 text-white/70">Both run on the Claude plan, not API credits. To steer what Claude looks for, edit the company profile.</p>
        </div>
      </div>
    </div>
  );
}

export function LinkProspects({ clientSlug, clientName }: { clientSlug: string; clientName: string }) {
  const [prospects, setProspects] = useState<LinkProspect[] | null>(null);
  const [profile, setProfile] = useState<LinkProfile | null>(null);
  const [show, setShow] = useState<"none" | "backlog" | "closed">("none");

  useEffect(() => {
    fetch(`/api/link-prospects?client=${clientSlug}`).then((r) => r.json()).then((d) => { setProspects(d.prospects || []); setProfile(d.profile || null); }).catch(() => setProspects([]));
  }, [clientSlug]);

  function patch(p: LinkProspect, body: { stage?: Stage; notes?: string }) {
    setProspects((list) => sortByPriority((list || []).map((x) => (x.id === p.id ? { ...x, ...body, ...(body.stage ? { stageChangedAt: new Date().toISOString(), followUpDue: false } : {}) } : x))));
    fetch("/api/link-prospects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: clientSlug, id: p.id, ...body }) });
  }

  if (!prospects) {
    return <Card><CardContent className="flex items-center gap-2 py-8 text-[14px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading link prospects…</CardContent></Card>;
  }

  const working = prospects.filter((p) => p.stage === "in_progress" || p.stage === "follow_up");
  const notStarted = prospects.filter((p) => p.stage === "not_started");
  const next = notStarted.slice(0, SHOWN);
  const backlog = notStarted.slice(SHOWN);
  const closed = prospects.filter((p) => p.stage === "completed" || p.stage === "dismissed");
  const won = prospects.filter((p) => p.stage === "completed").length;
  const command = `/link-prospects ${clientSlug}`;
  const row = (p: LinkProspect, rank: number | null) => (
    <ProspectRow key={p.id} p={p} rank={rank} onStage={(stage) => patch(p, { stage })} onNotes={(notes) => patch(p, { notes })} />
  );

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-semibold text-[#001A2E]">Link prospects</h3>
            <p className="mt-0.5 max-w-[680px] text-[14px] text-muted-foreground">
              Sites worth a link for {clientName}, easiest first, picked from the company profile below. Each one opens the page where the next step happens. Nothing is sent for you.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {prospects.length > 0 && (
              <p className="text-[13px] text-muted-foreground tabular-nums">{working.length} in progress · {notStarted.length} to start · {won} won</p>
            )}
            <HowToRefresh command={command} />
          </div>
        </div>

        <ProfileCard clientSlug={clientSlug} profile={profile} onSaved={setProfile} />

        {prospects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-5 py-6 text-[14px] text-[#001A2E]/80">
            <p className="flex items-center gap-1.5 font-semibold text-[#001A2E]"><Sparkles size={15} style={{ color: GREEN }} /> No prospects yet</p>
            <p className="mt-1">The weekly run on Monday mornings adds them. For some now, open the Claude app, go to Code and send <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">{command}</code> <CopyButton text={command} /></p>
          </div>
        ) : (
          <>
            {notStarted.length < SHOWN && (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[14px] text-[#001A2E]">
                {notStarted.length === 0 ? "Nothing left to start." : `Only ${notStarted.length} left to start.`} The Monday run adds more, or send <code className="rounded bg-white/70 px-1.5 py-0.5 text-[13px]">{command}</code> in the Claude app&apos;s Code tab for some now.
              </p>
            )}
            {working.length > 0 && (
              <div>
                <p className={eyebrow}>Working on</p>
                <ul className="divide-y divide-border/60">{working.map((p) => row(p, null))}</ul>
              </div>
            )}
            {next.length > 0 && (
              <div>
                <p className={eyebrow}>Up next</p>
                <ul className="divide-y divide-border/60">{next.map((p, i) => row(p, i + 1))}</ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {backlog.length > 0 && (
                <button className={btnSecondary} onClick={() => setShow(show === "backlog" ? "none" : "backlog")}>{show === "backlog" ? "Hide the backlog" : `Backlog (${backlog.length})`}</button>
              )}
              {closed.length > 0 && (
                <button className={btnSecondary} onClick={() => setShow(show === "closed" ? "none" : "closed")}>{show === "closed" ? "Hide completed and dismissed" : `Completed and dismissed (${closed.length})`}</button>
              )}
            </div>
            {show === "backlog" && <ul className="divide-y divide-border/60">{backlog.map((p, i) => row(p, SHOWN + i + 1))}</ul>}
            {show === "closed" && <ul className="divide-y divide-border/60">{closed.map((p) => row(p, null))}</ul>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
