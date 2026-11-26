"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, ChevronDown, ExternalLink, Loader2, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/avatar";

// "Assign" on an Agents card: the owner hands the card to a team member (it
// becomes a Work task linked to the card, so the draft and Apply stay with it).
// The assignee sees "Assigned to you". One shared, per-client store so every
// card on the page agrees without each one fetching.

interface Person { id: number; name: string; title: string; photoVersion?: string | null }
interface Assigned { taskId: number; assigneeId: number | null }
interface ClientState { isOwner: boolean; me: number | null; people: Person[]; byKey: Map<string, Assigned> }

const stores = new Map<string, ClientState | null>();
const loading = new Map<string, Promise<void>>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function load(clientSlug: string, force = false) {
  if (loading.has(clientSlug) || (stores.get(clientSlug) && !force)) return;
  const p = fetch(`/api/work-tasks?client=${encodeURIComponent(clientSlug)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return;
      const byKey = new Map<string, Assigned>();
      for (const t of d.tasks as { id: number; agentTaskKey: string | null; assigneeId: number | null }[]) {
        if (t.agentTaskKey && !byKey.has(t.agentTaskKey)) byKey.set(t.agentTaskKey, { taskId: t.id, assigneeId: t.assigneeId });
      }
      stores.set(clientSlug, { isOwner: d.isOwner, me: d.me, people: d.people, byKey });
      emit();
    })
    .catch(() => {})
    .finally(() => loading.delete(clientSlug));
  loading.set(clientSlug, p);
}

function useClientAssignments(clientSlug: string): ClientState | null {
  const state = useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => stores.get(clientSlug) ?? null,
    () => null,
  );
  useEffect(() => { load(clientSlug); }, [clientSlug]);
  return state;
}

export function AssignControl({ clientSlug, taskKey }: { clientSlug: string; taskKey: string }) {
  const state = useClientAssignments(clientSlug);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!state) return null;
  const assigned = state.byKey.get(taskKey);
  const assignee = assigned?.assigneeId ? state.people.find((p) => p.id === assigned.assigneeId) : undefined;

  // Team members only see work that's theirs.
  if (!state.isOwner) {
    return assigned && assigned.assigneeId === state.me ? (
      <Link href={`/work?task=${assigned.taskId}`} className="inline-flex items-center gap-1.5 rounded-full bg-[#0CA4C3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0F6E84] hover:bg-[#0CA4C3]/15 transition-colors duration-200">
        <Check size={13} /> Assigned to you
      </Link>
    ) : null;
  }

  async function assign(assigneeId: number | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/work-tasks/from-agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug, key: taskKey, assigneeId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't assign it.");
      const s = stores.get(clientSlug);
      if (s) { s.byKey = new Map(s.byKey).set(taskKey, { taskId: d.task.id, assigneeId: d.task.assigneeId }); stores.set(clientSlug, { ...s }); emit(); }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't assign it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} disabled={busy} aria-haspopup="listbox" aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white pl-2 pr-2.5 text-[13px] font-semibold text-[#01384C] shadow-[0_1px_2px_rgba(7,61,143,0.06),0_3px_8px_rgba(7,61,143,0.05)] transition-all duration-200 hover:shadow-[0_1px_2px_rgba(7,61,143,0.08),0_6px_14px_rgba(7,61,143,0.08)] disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin" /> : assignee ? <Avatar id={assignee.id} name={assignee.name} photoVersion={assignee.photoVersion} size={22} /> : <UserPlus size={15} />}
        <span className="max-w-[110px] truncate">{assignee ? assignee.name.split(" ")[0] : "Assign"}</span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 top-11 z-30 w-72 rounded-xl card-depth p-1.5 anim-pop">
          <p className="px-2.5 pb-1.5 pt-1 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Assign to a team member</p>
          {state.people.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted-foreground">Add people on the Team page first.</p>}
          {state.people.map((p) => (
            <button key={p.id} role="option" aria-selected={p.id === assigned?.assigneeId} onClick={() => assign(p.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-[#0CA4C3]/[0.08]">
              <Avatar id={p.id} name={p.name} photoVersion={p.photoVersion} size={28} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium text-[#131B30]">{p.name}</span><span className="block truncate text-[12px] text-muted-foreground">{p.title}</span></span>
              {p.id === assigned?.assigneeId && <Check size={15} className="text-[#0CA4C3]" />}
            </button>
          ))}
          {assigned && (
            <div className="mt-1 flex items-center justify-between border-t border-border/60 px-2.5 pt-2 pb-1">
              {assigned.assigneeId ? (
                <button onClick={() => assign(null)} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-red-600"><X size={13} /> Unassign</button>
              ) : <span />}
              <Link href={`/work?task=${assigned.taskId}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0394B2] hover:underline">Open in Work <ExternalLink size={12} /></Link>
            </div>
          )}
          {error && <p className="px-2.5 pt-1 text-[13px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
