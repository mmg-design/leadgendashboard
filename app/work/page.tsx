"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, CalendarDays, Clock, ExternalLink, Loader2, MessageSquare, Pencil, Play, Plus, Square, Trash2, UserRound, X } from "lucide-react";
import { clock, duration, refreshTimer, startTimerOn, stopTimer, useElapsed, useTimer } from "@/components/timer";
import AccountMenu from "@/components/account-menu";

// Delegated work. The owner sees every task and creates them, handing each to a
// team member, an agent, or both. Everyone else sees their own queue and moves
// their tasks along. Clients never see this page.

type Status = "todo" | "in_progress" | "review" | "done";
type Priority = "low" | "normal" | "high" | "urgent";
interface Task {
  id: number; clientSlug: string | null; title: string; notes: string | null; status: Status; priority: Priority;
  assigneeId: number | null; agentTaskKey: string | null; pagePath: string | null; dueDate: string | null;
  estimateMinutes: number | null; commentCount: number; completedAt: string | null; trackedSeconds?: number;
}
interface TimeEntry { id: number; memberId: number; memberName: string; startedAt: string; endedAt: string | null; durationSeconds: number | null; note: string | null; source: string; editedAt: string | null }
interface Person { id: number; name: string; title: string }
interface Client { slug: string; name: string }
interface Comment { id: number; authorName: string; body: string; createdAt: string }
interface AgentOut { summary?: string; proposedChange?: string; steps?: { title: string; detail: string }[] }

const COLUMNS: { status: Status; label: string; dot: string }[] = [
  { status: "todo", label: "To do", dot: "#94a3b8" },
  { status: "in_progress", label: "In progress", dot: "#2a78d6" },
  { status: "review", label: "In review", dot: "#e0a100" },
  { status: "done", label: "Done", dot: "#1baf7a" },
];
const PRIORITY: Record<Priority, { label: string; cls: string }> = {
  urgent: { label: "Urgent", cls: "bg-red-50 text-red-700 border-red-200" },
  high: { label: "High", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  normal: { label: "Normal", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  low: { label: "Low", cls: "bg-slate-50 text-slate-500 border-slate-200" },
};
const fieldBase = "rounded-lg border border-border bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#0CA4C3]/50 focus:ring-2 focus:ring-[#0CA4C3]/15";
const field = `w-full ${fieldBase}`;
const today = () => new Date().toISOString().slice(0, 10);
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const hours = (m: number | null) => (m == null ? "" : String(Math.round((m / 60) * 100) / 100));

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data as T;
}

export default function WorkPage() {
  return <Suspense><Work /></Suspense>;
}

function Work() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = Number(params.get("task")) || null;
  const [data, setData] = useState<{ tasks: Task[]; people: Person[]; clients: Client[]; isOwner: boolean; me: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<Set<number>>(new Set());
  const timer = useTimer();
  const timing = timer?.running?.taskId ?? null;

  async function toggleTimer(taskId: number) {
    try {
      if (timing === taskId) await stopTimer(); else await startTimerOn(taskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the timer.");
    }
    reload();
  }

  const reload = useCallback(() => {
    api<NonNullable<typeof data>>("/api/work-tasks").then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let alive = true;
    api<NonNullable<typeof data>>("/api/work-tasks").then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  const clientName = useMemo(() => new Map(data?.clients.map((c) => [c.slug, c.name]) || []), [data]);
  const person = useMemo(() => new Map(data?.people.map((p) => [p.id, p]) || []), [data]);
  const tasks = (data?.tasks || []).filter((t) =>
    (!clientFilter || t.clientSlug === clientFilter) &&
    (!personFilter || (personFilter === "agent" ? !!t.agentTaskKey && !t.assigneeId : personFilter === "none" ? !t.assigneeId : t.assigneeId === Number(personFilter))));

  const setOpen = (id: number | null) => router.replace(id ? `/work?task=${id}` : "/work", { scroll: false });

  async function runAgent(id: number) {
    setRunning((s) => new Set(s).add(id));
    try {
      await api(`/api/work-tasks/${id}/agent`, { method: "POST" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The agent hit an error.");
    } finally {
      setRunning((s) => { const n = new Set(s); n.delete(id); return n; });
      reload();
    }
  }

  async function moveTask(id: number, status: Status) {
    setData((d) => d && { ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, status } : t)) });
    try { await api(`/api/work-tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't move it."); }
    reload();
  }

  return (
    <div className="min-h-screen bg-[#F3FAFB] text-[#1D475E]">
      <div className="px-4 md:px-8 pt-5">
        <nav className="max-w-[1400px] mx-auto h-[64px] px-4 md:px-5 flex items-center justify-between rounded-2xl bg-white border border-[#1D475E]/[0.08] shadow-[0_1px_4px_rgba(29,71,94,0.06)]">
          <Link href="/" className="flex items-center gap-2.5 text-[15px] font-medium text-[#3E4F5E] hover:text-[#131B30]">
            <ArrowLeft size={16} />
            <Image src="/mmg-icon.png" alt="" width={28} height={28} className="rounded-lg" />
            <span className="hidden sm:inline">All clients</span>
          </Link>
          <AccountMenu />
        </nav>
      </div>

      <main className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-headline text-[34px] md:text-[40px] tracking-tight text-[#131B30]">{data?.isOwner === false ? "My queue" : "Work"}</h1>
            <p className="mt-1 text-[15px] text-[#3E4F5E]">
              {data?.isOwner === false ? "Tasks assigned to you. Move them along as you go, and run an agent when it helps." : "Every task across clients. Hand each one to a person, an agent, or both."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/time" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2.5 text-[15px] font-medium hover:bg-slate-50">
              <Clock size={16} /> {data?.isOwner === false ? "My time" : "Time reports"}
            </Link>
            {data?.isOwner && (
              <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 btn-mmg-blue px-4 py-2.5 text-[15px]">
                <Plus size={16} /> New task
              </button>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}<button onClick={() => setError(null)} aria-label="Dismiss"><X size={15} /></button>
          </p>
        )}

        {data && (
          <div className="flex flex-wrap gap-3">
            <select className={`${fieldBase} min-w-[180px]`} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label="Filter by client">
              <option value="">All clients</option>
              {data.clients.filter((c) => data.tasks.some((t) => t.clientSlug === c.slug)).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
            {data.isOwner && (
              <select className={`${fieldBase} min-w-[180px]`} value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} aria-label="Filter by person">
                <option value="">Everyone</option>
                {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="agent">Agent only</option>
                <option value="none">Unassigned</option>
              </select>
            )}
          </div>
        )}

        {!data ? (
          <Loader2 className="animate-spin text-muted-foreground" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const list = tasks.filter((t) => t.status === col.status);
              return (
                <section key={col.status} className="rounded-2xl bg-white/70 border border-[#1D475E]/[0.08] p-3 min-h-[180px]">
                  <h2 className="flex items-center gap-2 px-1 pb-3 text-[14px] font-semibold text-[#131B30]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.dot }} />{col.label}
                    <span className="ml-auto text-[13px] font-normal text-muted-foreground">{list.length}</span>
                  </h2>
                  <div className="space-y-2.5">
                    {list.map((t) => (
                      <TaskCard key={t.id} t={t} client={t.clientSlug ? clientName.get(t.clientSlug) : undefined}
                        assignee={t.assigneeId ? person.get(t.assigneeId) : undefined} running={running.has(t.id)}
                        canTrack={!!timer?.canTrack && t.status !== "done" && (data.isOwner || t.assigneeId === data.me)}
                        timingSince={timing === t.id ? timer?.running?.startedAt ?? null : null}
                        onTimer={() => toggleTimer(t.id)} onOpen={() => setOpen(t.id)} />
                    ))}
                    {list.length === 0 && <p className="px-1 py-4 text-[13px] text-muted-foreground">Nothing here.</p>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      {creating && data && (
        <NewTask clients={data.clients} people={data.people} onClose={() => setCreating(false)}
          onCreated={(t, runNow) => { setCreating(false); reload(); if (runNow) runAgent(t.id); }} />
      )}
      {openId && data && (
        <TaskDrawer key={openId} id={openId} isOwner={data.isOwner} clients={data.clients} people={data.people}
          running={running.has(openId)} onClose={() => setOpen(null)} onChanged={() => { reload(); refreshTimer(); }}
          timingSince={timing === openId ? timer?.running?.startedAt ?? null : null} canTrack={!!timer?.canTrack} trackReason={timer?.reason}
          onTimer={() => toggleTimer(openId)}
          onRunAgent={() => runAgent(openId)} onMove={(s) => moveTask(openId, s)} />
      )}
    </div>
  );
}

function TaskCard({ t, client, assignee, running, canTrack, timingSince, onTimer, onOpen }: {
  t: Task; client?: string; assignee?: Person; running: boolean; canTrack: boolean; timingSince: string | null; onTimer: () => void; onOpen: () => void;
}) {
  const overdue = t.dueDate && t.status !== "done" && t.dueDate < today();
  const elapsed = useElapsed(timingSince);
  const tracked = t.trackedSeconds || 0;
  const over = !!t.estimateMinutes && tracked > t.estimateMinutes * 60;
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className={`w-full text-left rounded-xl bg-white border p-3 shadow-[0_1px_2px_rgba(29,71,94,0.05)] hover:border-[#0CA4C3]/40 hover:shadow-md transition cursor-pointer ${timingSince ? "border-[#0CA4C3] ring-2 ring-[#0CA4C3]/20" : "border-[#1D475E]/[0.1]"}`}>
      {client && <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-[#4AA2C0] truncate">{client}</div>}
      <div className="text-[15px] font-semibold leading-snug text-[#131B30]">{t.title}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px]">
        {t.priority !== "normal" && <span className={`rounded-full border px-2 py-0.5 font-medium ${PRIORITY[t.priority].cls}`}>{PRIORITY[t.priority].label}</span>}
        {t.dueDate && <span className={`inline-flex items-center gap-1 ${overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}><CalendarDays size={12} />{t.dueDate}</span>}
        {t.commentCount > 0 && <span className="inline-flex items-center gap-1 text-muted-foreground"><MessageSquare size={12} />{t.commentCount}</span>}
        {(tracked > 0 || t.estimateMinutes) && (
          <span className={`inline-flex items-center gap-1 ${over ? "text-red-600 font-medium" : "text-muted-foreground"}`} title="Tracked / estimate">
            <Clock size={12} />{duration(tracked)}{t.estimateMinutes ? ` / ${duration(t.estimateMinutes * 60)}` : ""}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {(t.agentTaskKey || running) && (
            <span className={`inline-flex items-center gap-1 rounded-full bg-[#1D475E]/[0.07] px-2 py-0.5 font-medium text-[#1D475E] ${running ? "animate-pulse" : ""}`}>
              {running ? <Loader2 size={11} className="animate-spin" /> : <Bot size={11} />}{running ? "Drafting" : "Agent"}
            </span>
          )}
          {assignee ? (
            <span title={`${assignee.name} · ${assignee.title}`} className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1D475E] text-[10px] font-semibold text-white">{initials(assignee.name)}</span>
          ) : !t.agentTaskKey && <span title="Unassigned" className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400"><UserRound size={12} /></span>}
        </span>
      </div>
      {canTrack && (
        <button onClick={(e) => { e.stopPropagation(); onTimer(); }} onKeyDown={(e) => e.stopPropagation()}
          className={`mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${timingSince ? "bg-[#1D475E] text-white hover:bg-[#163a4d]" : "bg-[#0CA4C3]/[0.1] text-[#0F6E84] hover:bg-[#0CA4C3]/[0.18]"}`}>
          {timingSince ? <><Square size={11} fill="currentColor" /> Stop · <span className="tabular-nums">{clock(elapsed)}</span></> : <><Play size={12} fill="currentColor" /> Start</>}
        </button>
      )}
    </div>
  );
}

function NewTask({ clients, people, onClose, onCreated }: {
  clients: Client[]; people: Person[]; onClose: () => void; onCreated: (t: Task, runAgentNow: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [clientSlug, setClientSlug] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"person" | "agent" | "both">("person");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [estimate, setEstimate] = useState("");
  const [pagePath, setPagePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsClient = mode !== "person";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { task } = await api<{ task: Task }>("/api/work-tasks", {
        method: "POST",
        body: JSON.stringify({
          title, clientSlug: clientSlug || null, notes, priority, dueDate: dueDate || null, pagePath: pagePath || null,
          estimateMinutes: estimate ? Math.round(Number(estimate) * 60) : null,
          assigneeId: mode === "agent" ? null : assigneeId || null,
          runWithAgent: mode !== "person",
        }),
      });
      onCreated(task, mode !== "person");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the task.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#011421]/50 p-4 md:p-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="w-full max-w-[640px] rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-semibold text-[#131B30]">New task</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted-foreground">What needs doing</span>
          <input className={field} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rewrite the softball page intro" />
        </label>
        <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted-foreground">Instructions</span>
          <textarea className={`${field} min-h-[96px]`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, links, what done looks like" />
        </label>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Who does it</span>
          <div className="grid sm:grid-cols-3 gap-2">
            {([["person", "A team member", UserRound], ["agent", "An agent", Bot], ["both", "Agent drafts, person finishes", Bot]] as const).map(([m, label, Icon]) => (
              <button type="button" key={m} onClick={() => setMode(m)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[14px] ${mode === m ? "border-[#0CA4C3] bg-[#0CA4C3]/[0.06] font-semibold text-[#131B30]" : "border-border text-[#3E4F5E]"}`}>
                <Icon size={15} className="shrink-0" />{label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted-foreground">Client{needsClient ? "" : " (optional)"}</span>
            <select className={field} value={clientSlug} onChange={(e) => setClientSlug(e.target.value)} required={needsClient}>
              <option value="">{needsClient ? "Pick a client" : "No client (internal)"}</option>
              {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          {mode !== "agent" && (
            <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted-foreground">Assign to</span>
              <select className={field} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Unassigned</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.title}</option>)}
              </select>
            </label>
          )}
          <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted-foreground">Priority</span>
            <select className={field} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted-foreground">Due date</span>
            <input className={field} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted-foreground">Estimate (hours)</span>
            <input className={field} inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="e.g. 1.5" />
          </label>
          {clientSlug && (
            <label className="block"><span className="mb-1 block text-[13px] font-medium text-muted-foreground">Page (optional)</span>
              <input className={field} value={pagePath} onChange={(e) => setPagePath(e.target.value)} placeholder="/training/softball" />
            </label>
          )}
        </div>
        {needsClient && <p className="text-[13px] text-muted-foreground">The agent drafts the work in the client&apos;s Agents tab. Nothing changes on their site until someone applies it.</p>}
        {error && <p role="alert" className="text-[14px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-[15px] text-[#3E4F5E] hover:bg-slate-100">Cancel</button>
          <button disabled={busy || !title || (needsClient && !clientSlug)} className="inline-flex items-center gap-1.5 btn-mmg-blue px-4 py-2.5 text-[15px] disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />}{mode === "person" ? "Create task" : "Create and run agent"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TaskDrawer({ id, isOwner, clients, people, running, onClose, onChanged, onRunAgent, onMove, timingSince, canTrack, trackReason, onTimer }: {
  id: number; isOwner: boolean; clients: Client[]; people: Person[]; running: boolean;
  onClose: () => void; onChanged: () => void; onRunAgent: () => void; onMove: (s: Status) => void;
  timingSince: string | null; canTrack: boolean; trackReason?: string; onTimer: () => void;
}) {
  const [detail, setDetail] = useState<{ task: Task; comments: Comment[]; agent: { key: string; status: string; output: AgentOut | null } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<NonNullable<typeof detail>>(`/api/work-tasks/${id}`).then((d) => alive && setDetail(d)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id, tick, running]);

  const refresh = () => { setTick((n) => n + 1); onChanged(); };
  async function patch(body: object) {
    try { await api(`/api/work-tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save."); }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    try { const d = await api<{ comments: Comment[] }>(`/api/work-tasks/${id}/comments`, { method: "POST", body: JSON.stringify({ body: comment }) }); setComment(""); setDetail((x) => x && { ...x, comments: d.comments }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't post."); }
  }
  async function remove() {
    if (!confirm("Delete this task? This can't be undone.")) return;
    try { await api(`/api/work-tasks/${id}`, { method: "DELETE" }); onChanged(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete."); }
  }

  const t = detail?.task;
  const small = "rounded-md border border-border bg-white px-2 py-1.5 text-[14px] outline-none focus:border-[#0CA4C3]/50 w-full";
  const out = detail?.agent?.output;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#011421]/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="h-full w-full max-w-[560px] overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-white px-5 py-3">
          <span className="text-[13px] font-medium text-muted-foreground">Task #{id}</span>
          <div className="flex items-center gap-1">
            {isOwner && t && <button onClick={remove} aria-label="Delete task" className="rounded-full p-2 text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>}
            <button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-slate-100"><X size={18} /></button>
          </div>
        </div>
        {error && <p role="alert" className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">{error}</p>}
        {!t ? <div className="p-6"><Loader2 className="animate-spin text-muted-foreground" /></div> : (
          <div className="space-y-6 p-5">
            <div>
              {isOwner ? (
                <input defaultValue={t.title} onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && patch({ title: e.target.value })}
                  className="w-full rounded-md border border-transparent px-1 -mx-1 text-[22px] font-semibold text-[#131B30] hover:border-border focus:border-[#0CA4C3]/50 outline-none" aria-label="Title" />
              ) : <h2 className="text-[22px] font-semibold text-[#131B30]">{t.title}</h2>}
              {t.clientSlug && (
                <Link href={`/${t.clientSlug}`} className="mt-1 inline-flex items-center gap-1 text-[14px] font-medium text-[#0394B2] hover:underline">
                  {clients.find((c) => c.slug === t.clientSlug)?.name || t.clientSlug}{t.pagePath ? ` · ${t.pagePath}` : ""} <ExternalLink size={12} />
                </Link>
              )}
            </div>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Status</span>
              <div className="flex flex-wrap gap-1.5">
                {COLUMNS.map((c) => (
                  <button key={c.status} onClick={() => { onMove(c.status); setDetail((d) => d && { ...d, task: { ...d.task, status: c.status } }); }}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${t.status === c.status ? "border-[#131B30] bg-[#131B30] text-white font-semibold" : "border-border text-[#3E4F5E] hover:bg-slate-50"}`}>
                    <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />{c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[14px]">
              <Field label="Assigned to">
                {isOwner ? (
                  <select className={small} value={t.assigneeId ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
                    <option value="">{t.agentTaskKey ? "Agent only" : "Unassigned"}</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : <span>{people.find((p) => p.id === t.assigneeId)?.name || "You"}</span>}
              </Field>
              <Field label="Priority">
                {isOwner ? (
                  <select className={small} value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
                    {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
                  </select>
                ) : <span>{PRIORITY[t.priority].label}</span>}
              </Field>
              <Field label="Due">
                {isOwner ? <input type="date" className={small} defaultValue={t.dueDate || ""} onBlur={(e) => e.target.value !== (t.dueDate || "") && patch({ dueDate: e.target.value || null })} />
                  : <span>{t.dueDate || "No date"}</span>}
              </Field>
              <Field label="Estimate (hours)">
                {isOwner ? <input inputMode="decimal" className={small} defaultValue={hours(t.estimateMinutes)} onBlur={(e) => e.target.value !== hours(t.estimateMinutes) && patch({ estimateMinutes: e.target.value ? Math.round(Number(e.target.value) * 60) : null })} />
                  : <span>{t.estimateMinutes ? `${hours(t.estimateMinutes)} h` : "None"}</span>}
              </Field>
            </div>

            <Field label="Instructions">
              {isOwner ? (
                <textarea defaultValue={t.notes || ""} onBlur={(e) => e.target.value !== (t.notes || "") && patch({ notes: e.target.value })}
                  className="w-full min-h-[90px] rounded-lg border border-border px-3 py-2 text-[14px] outline-none focus:border-[#0CA4C3]/50" placeholder="Add instructions" />
              ) : <p className="whitespace-pre-line text-[14px] leading-relaxed text-[#131B30]">{t.notes || "No instructions."}</p>}
            </Field>

            <TimeSection taskId={t.id} done={t.status === "done"} estimateMinutes={t.estimateMinutes} isOwner={isOwner}
              timingSince={timingSince} canTrack={canTrack} trackReason={trackReason} onTimer={onTimer} onChanged={onChanged} />

            <section className="rounded-xl border border-[#1D475E]/[0.12] bg-[#F6F9FA] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[#131B30]"><Bot size={16} /> Agent</h3>
                <button onClick={onRunAgent} disabled={running || !t.clientSlug}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D475E] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#163a4d] disabled:opacity-50">
                  {running ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}{running ? "Drafting…" : out ? "Run again" : "Run agent"}
                </button>
              </div>
              {!t.clientSlug && <p className="text-[13px] text-muted-foreground">Agents work on a client&apos;s site. Add a client to this task to use one.</p>}
              {running && <p className="text-[13px] text-muted-foreground">The agent is reading the site and writing the draft. This can take a minute or two.</p>}
              {out && !running && (
                <div className="space-y-3 text-[14px]">
                  {out.summary && <p className="leading-relaxed text-[#131B30]">{out.summary}</p>}
                  {out.proposedChange && <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg bg-white border border-border p-3 font-sans text-[14px] leading-relaxed text-[#131B30]">{out.proposedChange}</pre>}
                  {!!out.steps?.length && (
                    <ol className="list-decimal space-y-1 pl-5 text-[#3E4F5E]">{out.steps.map((s, i) => <li key={i}><strong className="text-[#131B30]">{s.title}.</strong> {s.detail}</li>)}</ol>
                  )}
                  <Link href={`/${t.clientSlug}?section=agents`} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0394B2] hover:underline">Open in the Agents tab to apply <ExternalLink size={12} /></Link>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-[15px] font-semibold text-[#131B30]">Comments</h3>
              {detail.comments.length === 0 && <p className="text-[13px] text-muted-foreground">No comments yet.</p>}
              {detail.comments.map((c) => (
                <div key={c.id} className="rounded-lg border border-border/70 px-3 py-2">
                  <div className="text-[12px] text-muted-foreground"><strong className="text-[#131B30]">{c.authorName}</strong> · {new Date(c.createdAt.replace(" ", "T") + "Z").toLocaleString()}</div>
                  <p className="mt-1 whitespace-pre-line text-[14px] text-[#131B30]">{c.body}</p>
                </div>
              ))}
              <form onSubmit={send} className="flex gap-2">
                <input className={field} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" aria-label="Write a comment" />
                <button disabled={!comment.trim()} className="btn-mmg-blue px-4 text-[14px] disabled:opacity-50">Post</button>
              </form>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="mb-1 block text-[12px] font-medium text-muted-foreground">{label}</span>{children}</div>;
}

// Time on this task: Start/Stop, the entries (everyone's for the owner, your
// own otherwise), corrections, and time added by hand.
function TimeSection({ taskId, done, estimateMinutes, isOwner, timingSince, canTrack, trackReason, onTimer, onChanged }: {
  taskId: number; done: boolean; estimateMinutes: number | null; isOwner: boolean; timingSince: string | null;
  canTrack: boolean; trackReason?: string; onTimer: () => void; onChanged: () => void;
}) {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [me, setMe] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed(timingSince);

  useEffect(() => {
    let alive = true;
    api<{ entries: TimeEntry[]; me: number | null }>(`/api/time/entries?taskId=${taskId}`)
      .then((d) => { if (alive) { setEntries(d.entries); setMe(d.me); } })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [taskId, tick, timingSince]);

  const refresh = () => { setTick((n) => n + 1); onChanged(); };
  const finished = (entries || []).reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0);
  const total = finished + (timingSince ? elapsed : 0);
  const over = !!estimateMinutes && total > estimateMinutes * 60;

  async function edit(e: TimeEntry) {
    const current = Math.round((e.durationSeconds ?? 0) / 60);
    const raw = prompt("Minutes for this entry", String(current));
    if (raw === null) return;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0) return setError("Enter a number of minutes.");
    try { await api(`/api/time/entries/${e.id}`, { method: "PATCH", body: JSON.stringify({ minutes }) }); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't save."); }
  }
  async function remove(e: TimeEntry) {
    if (!confirm("Delete this time entry?")) return;
    try { await api(`/api/time/entries/${e.id}`, { method: "DELETE" }); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't delete."); }
  }

  return (
    <section className="rounded-xl border border-[#1D475E]/[0.12] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[#131B30]"><Clock size={16} /> Time</h3>
          <p className={`text-[13px] ${over ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
            {duration(total)} tracked{estimateMinutes ? ` of ${duration(estimateMinutes * 60)} estimated` : ""}{isOwner ? " (everyone)" : ""}
          </p>
        </div>
        {canTrack && !done && (
          <button onClick={onTimer} className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[14px] font-semibold ${timingSince ? "bg-[#1D475E] text-white hover:bg-[#163a4d]" : "btn-mmg-blue"}`}>
            {timingSince ? <><Square size={12} fill="currentColor" /> Stop · <span className="tabular-nums">{clock(elapsed)}</span></> : <><Play size={13} fill="currentColor" /> Start timer</>}
          </button>
        )}
      </div>
      {!canTrack && <p className="text-[13px] text-muted-foreground">{trackReason || "Sign in with your own login to track time."}</p>}
      {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
      {entries && entries.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 text-[13px]">
          {entries.map((e) => {
            const mine = e.memberId === me;
            return (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[#131B30]">
                    <strong>{e.endedAt ? duration(e.durationSeconds ?? 0) : "Running"}</strong>
                    {isOwner && <span className="text-muted-foreground"> · {e.memberName}</span>}
                    <span className="text-muted-foreground"> · {new Date(e.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    {e.source === "manual" && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">added by hand</span>}
                    {e.source === "auto_stopped" && !e.editedAt && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">auto-stopped: check it</span>}
                    {e.editedAt && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">edited</span>}
                  </div>
                  {e.note && <div className="truncate text-muted-foreground">{e.note}</div>}
                </div>
                {e.endedAt && (mine || isOwner) && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => edit(e)} aria-label="Edit time" className="rounded p-1.5 text-muted-foreground hover:bg-slate-100"><Pencil size={13} /></button>
                    <button onClick={() => remove(e)} aria-label="Delete time" className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canTrack && (adding ? <AddTime taskId={taskId} onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)} className="text-[13px] font-medium text-[#0394B2] hover:underline">+ Add time by hand</button>)}
    </section>
  );
}

function AddTime({ taskId, onDone, onCancel }: { taskId: number; onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState(today());
  const [h, setH] = useState("");
  const [m, setM] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minutes = (Number(h) || 0) * 60 + (Number(m) || 0);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Logged at 9am local time on the chosen day.
      const startedAt = new Date(`${date}T09:00:00`).toISOString();
      await api("/api/time/entries", { method: "POST", body: JSON.stringify({ taskId, startedAt, minutes, note }) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add time.");
      setBusy(false);
    }
  }
  const small = "rounded-md border border-border bg-white px-2 py-1.5 text-[14px] outline-none focus:border-[#0CA4C3]/50";
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg bg-[#F6F9FA] p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] text-muted-foreground">Date<input type="date" className={`${small} block`} value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="text-[12px] text-muted-foreground">Hours<input inputMode="numeric" className={`${small} block w-16`} value={h} onChange={(e) => setH(e.target.value)} /></label>
        <label className="text-[12px] text-muted-foreground">Minutes<input inputMode="numeric" className={`${small} block w-16`} value={m} onChange={(e) => setM(e.target.value)} /></label>
      </div>
      <input className={`${small} w-full`} placeholder="What you did (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy || minutes <= 0} className="btn-mmg-blue px-3 py-1.5 text-[13px] disabled:opacity-50">Add {minutes > 0 ? duration(minutes * 60) : "time"}</button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[13px] text-[#3E4F5E] hover:bg-slate-100">Cancel</button>
      </div>
    </form>
  );
}
