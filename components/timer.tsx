"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, Square } from "lucide-react";

// The signed-in person's timer, shared by the header pill and the Work page so
// both always agree. One timer per person; starting another stops this one.

export interface RunningTimer {
  id: number; taskId: number; taskTitle: string; clientSlug: string | null; clientName: string | null; startedAt: string;
}
export interface TimerState {
  running: RunningTimer | null;
  needsReview: { id: number; taskId: number }[];
  canTrack: boolean;
  reason?: string;
  maxHours?: number;
}

let state: TimerState | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function refreshTimer(): Promise<void> {
  loading ??= fetch("/api/time")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { state = d; emit(); })
    .catch(() => {})
    .finally(() => { loading = null; });
  return loading;
}

async function post(body: object): Promise<void> {
  const r = await fetch("/api/time", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  await refreshTimer();
  if (!r.ok) throw new Error(data.error || "Couldn't update the timer.");
}
export const startTimerOn = (taskId: number) => post({ action: "start", taskId });
export const stopTimer = (note?: string) => post({ action: "stop", note });

export function useTimer(): TimerState | null {
  const snap = useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => state,
    () => null,
  );
  useEffect(() => {
    if (!state) refreshTimer();
    // Keep in step with other tabs and devices.
    const t = setInterval(refreshTimer, 60_000);
    const onFocus = () => refreshTimer();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, []);
  return snap;
}

// Seconds since a time, re-rendering every second while mounted.
export function useElapsed(since: string | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) : 0;
}

export const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
export const duration = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

// Header pill: the running task and its clock, with Stop. Hidden when idle.
export default function TimerPill() {
  const timer = useTimer();
  const elapsed = useElapsed(timer?.running?.startedAt);
  const [busy, setBusy] = useState(false);
  if (!timer) return null;
  const review = timer.needsReview?.[0];

  if (!timer.running) {
    return review ? (
      <Link href={`/work?task=${review.taskId}`} title={`A timer ran past ${timer.maxHours ?? 10} hours and was stopped. Check the time.`}
        className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] font-medium text-amber-800 hover:bg-amber-100">
        <AlertTriangle size={14} /> Check stopped timer
      </Link>
    ) : null;
  }

  const r = timer.running;
  return (
    <div className="flex items-center gap-1 rounded-full border border-[#0CA4C3]/30 bg-[#0CA4C3]/[0.08] py-1 pl-3 pr-1 max-w-[46vw] sm:max-w-[360px]">
      <span className="relative mr-1 flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" /></span>
      <Link href={`/work?task=${r.taskId}`} className="min-w-0 truncate text-[13px] text-[#1D475E] hover:underline" title={`${r.taskTitle}${r.clientName ? ` · ${r.clientName}` : ""}`}>
        <span className="font-semibold tabular-nums">{clock(elapsed)}</span>
        <span className="hidden md:inline"> · {r.taskTitle}</span>
      </Link>
      <button
        onClick={async () => { setBusy(true); try { await stopTimer(); } catch { /* the pill refreshes either way */ } setBusy(false); }}
        disabled={busy}
        aria-label="Stop timer"
        title="Stop timer"
        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1D475E] text-white hover:bg-[#163a4d] disabled:opacity-50"
      >
        <Square size={11} fill="currentColor" />
      </button>
    </div>
  );
}
