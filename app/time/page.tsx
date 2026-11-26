"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import AccountMenu from "@/components/account-menu";
import { duration } from "@/components/timer";

// Weekly time. The owner sees the whole team: a timesheet of people by day,
// hours and contractor cost per client, and time against estimate per task.
// Everyone else sees the same views for their own time, without rates or cost.

interface Entry {
  id: number; memberId: number; taskId: number; taskTitle: string; clientSlug: string | null; day: string;
  startedAt: string; endedAt: string | null; seconds: number; running: boolean; note: string | null; source: string; edited: boolean;
  rateCents?: number | null; costCents?: number | null;
}
interface Person { id: number; name: string; title: string; kind: "employee" | "contractor" }
interface Report {
  isOwner: boolean; days: string[]; people: Person[]; clients: Record<string, string>; entries: Entry[];
  tasks: { id: number; totalSeconds: number; estimateMinutes: number | null; assigneeId: number | null }[];
}

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (s: number) => (s ? duration(s) : "—");

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });

export default function TimePage() {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [client, setClient] = useState("");
  const [cell, setCell] = useState<{ title: string; entries: Entry[] } | null>(null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = `from=${encodeURIComponent(week.toISOString())}&to=${encodeURIComponent(addDays(week, 7).toISOString())}&tz=${encodeURIComponent(tz)}`;

  useEffect(() => {
    let alive = true;
    fetch(`/api/reports/time?${query}`)
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok) return setError(data.error || "Couldn't load the report.");
        setError(null);
        setReport(data);
      })
      .catch(() => alive && setError("Couldn't load the report."));
    return () => { alive = false; };
  }, [query]);

  const entries = useMemo(() => (report?.entries || []).filter((e) =>
    (!person || e.memberId === Number(person)) && (!client || (client === "internal" ? !e.clientSlug : e.clientSlug === client))), [report, person, client]);
  const people = (report?.people || []).filter((p) => !person || p.id === Number(person));
  const clientName = (slug: string | null) => (slug ? report?.clients[slug] || slug : "Internal");
  const total = entries.reduce((s, e) => s + e.seconds, 0);
  const cost = entries.reduce((s, e) => s + (e.costCents || 0), 0);
  const isThisWeek = ymd(week) === ymd(mondayOf(new Date()));
  const rangeLabel = `${week.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(week, 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  const byClient = useMemo(() => {
    const m = new Map<string, { slug: string | null; seconds: number; cost: number; people: Set<number> }>();
    for (const e of entries) {
      const k = e.clientSlug || "";
      const row = m.get(k) || { slug: e.clientSlug, seconds: 0, cost: 0, people: new Set<number>() };
      row.seconds += e.seconds; row.cost += e.costCents || 0; row.people.add(e.memberId);
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => b.seconds - a.seconds);
  }, [entries]);

  const byTask = useMemo(() => {
    const m = new Map<number, { id: number; title: string; slug: string | null; seconds: number; people: Set<number> }>();
    for (const e of entries) {
      const row = m.get(e.taskId) || { id: e.taskId, title: e.taskTitle, slug: e.clientSlug, seconds: 0, people: new Set<number>() };
      row.seconds += e.seconds; row.people.add(e.memberId);
      m.set(e.taskId, row);
    }
    return [...m.values()].sort((a, b) => b.seconds - a.seconds);
  }, [entries]);
  const taskInfo = new Map(report?.tasks.map((t) => [t.id, t]) || []);
  const name = (id: number) => report?.people.find((p) => p.id === id)?.name || "Former team member";

  return (
    <div className="min-h-screen bg-[#F3FAFB] text-[#1D475E]">
      <div className="px-4 md:px-8 pt-5">
        <nav className="max-w-[1240px] mx-auto h-[64px] px-4 md:px-5 flex items-center justify-between rounded-2xl bg-white border border-[#1D475E]/[0.08] shadow-[0_1px_4px_rgba(29,71,94,0.06)]">
          <Link href="/" className="flex items-center gap-2.5 text-[15px] font-medium text-[#3E4F5E] hover:text-[#131B30]">
            <ArrowLeft size={16} />
            <Image src="/mmg-icon.png" alt="" width={28} height={28} className="rounded-lg" />
            <span className="hidden sm:inline">All clients</span>
          </Link>
          <AccountMenu />
        </nav>
      </div>

      <main className="max-w-[1240px] mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-headline text-[34px] md:text-[40px] tracking-tight text-[#131B30]">{report?.isOwner === false ? "My time" : "Time"}</h1>
            <p className="mt-1 text-[15px] text-[#3E4F5E]">
              {report?.isOwner === false ? "Your tracked time by day, client and task." : "Who worked on what, for which client, week by week."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-white">
              <button onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week" className="p-2.5 hover:bg-slate-50"><ChevronLeft size={16} /></button>
              <span className="px-2 text-[14px] font-medium text-[#131B30] tabular-nums">{rangeLabel}</span>
              <button onClick={() => setWeek(addDays(week, 7))} aria-label="Next week" disabled={isThisWeek} className="p-2.5 hover:bg-slate-50 disabled:opacity-30"><ChevronRight size={16} /></button>
            </div>
            {!isThisWeek && <button onClick={() => setWeek(mondayOf(new Date()))} className="rounded-lg px-3 py-2 text-[14px] font-medium text-[#0394B2] hover:bg-white">This week</button>}
            <a href={`/api/reports/time?${query}&format=csv`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[14px] font-medium hover:bg-slate-50">
              <Download size={15} /> Export CSV
            </a>
          </div>
        </div>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">{error}</p>}

        {!report ? <Loader2 className="animate-spin text-muted-foreground" /> : (
          <>
            {report.isOwner && (
              <div className="flex flex-wrap gap-3">
                <select className="rounded-lg border border-border bg-white px-3 py-2.5 text-[15px] min-w-[180px]" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
                  <option value="">Everyone</option>
                  {report.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="rounded-lg border border-border bg-white px-3 py-2.5 text-[15px] min-w-[180px]" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Filter by client">
                  <option value="">All clients</option>
                  {[...new Set(report.entries.map((e) => e.clientSlug))].map((s) => <option key={s || "internal"} value={s || "internal"}>{clientName(s)}</option>)}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Hours tracked" value={hrs(total)} />
              {report.isOwner ? <Stat label="Contractor cost" value={money(cost)} hint="Hours × each contractor's rate when they tracked it" /> : <Stat label="Tasks worked on" value={String(byTask.length)} />}
              <Stat label={report.isOwner ? "People tracking" : "Clients"} value={String(report.isOwner ? new Set(entries.map((e) => e.memberId)).size : byClient.length)} />
              <Stat label={report.isOwner ? "Clients" : "Busiest day"} value={report.isOwner ? String(byClient.length) : busiestDay(entries)} />
            </div>

            <Panel title="Timesheet">
              {people.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[14px]">
                    <thead className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Person</th>
                        {report.days.map((d) => <th key={d} className="px-2 py-2.5 text-right font-medium">{dayLabel(d)}</th>)}
                        <th className="px-4 py-2.5 text-right font-medium">Total</th>
                        {report.isOwner && <th className="px-4 py-2.5 text-right font-medium">Cost</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((p) => {
                        const mine = entries.filter((e) => e.memberId === p.id);
                        const sum = mine.reduce((s, e) => s + e.seconds, 0);
                        return (
                          <tr key={p.id} className="border-t border-border/60">
                            <td className="px-4 py-2.5">
                              <div className="font-semibold text-[#131B30]">{p.name}</div>
                              <div className="text-[12px] text-muted-foreground">{p.title}{p.kind === "contractor" ? " · contractor" : ""}</div>
                            </td>
                            {report.days.map((d) => {
                              const dayEntries = mine.filter((e) => e.day === d);
                              const s = dayEntries.reduce((x, e) => x + e.seconds, 0);
                              return (
                                <td key={d} className="px-2 py-2.5 text-right tabular-nums">
                                  {s ? (
                                    <button onClick={() => setCell({ title: `${p.name} · ${dayLabel(d)}`, entries: dayEntries })} className="rounded px-1.5 py-0.5 font-medium text-[#131B30] hover:bg-[#0CA4C3]/10">
                                      {duration(s)}{dayEntries.some((e) => e.running) ? " •" : ""}
                                    </button>
                                  ) : <span className="text-slate-300">—</span>}
                                </td>
                              );
                            })}
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[#131B30]">{hrs(sum)}</td>
                            {report.isOwner && <td className="px-4 py-2.5 text-right tabular-nums">{p.kind === "contractor" ? money(mine.reduce((s, e) => s + (e.costCents || 0), 0)) : <span className="text-muted-foreground">—</span>}</td>}
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-border bg-[#F6F9FA] font-semibold">
                        <td className="px-4 py-2.5">Total</td>
                        {report.days.map((d) => <td key={d} className="px-2 py-2.5 text-right tabular-nums">{hrs(entries.filter((e) => e.day === d).reduce((s, e) => s + e.seconds, 0))}</td>)}
                        <td className="px-4 py-2.5 text-right tabular-nums">{hrs(total)}</td>
                        {report.isOwner && <td className="px-4 py-2.5 text-right tabular-nums">{money(cost)}</td>}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="By client">
                {byClient.length === 0 ? <Empty /> : (
                  <ul className="divide-y divide-border/60">
                    {byClient.map((c) => (
                      <li key={c.slug || "internal"} className="px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3 text-[14px]">
                          <span className="font-semibold text-[#131B30]">{clientName(c.slug)}</span>
                          <span className="tabular-nums"><strong className="text-[#131B30]">{duration(c.seconds)}</strong>{report.isOwner && c.cost > 0 && <span className="text-muted-foreground"> · {money(c.cost)}</span>}</span>
                        </div>
                        <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-[#0CA4C3]" style={{ width: `${Math.max(2, (c.seconds / (total || 1)) * 100)}%` }} />
                        </div>
                        {report.isOwner && <div className="mt-1 text-[12px] text-muted-foreground">{[...c.people].map(name).join(", ")}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="By task">
                {byTask.length === 0 ? <Empty /> : (
                  <ul className="divide-y divide-border/60">
                    {byTask.map((t) => {
                      const info = taskInfo.get(t.id);
                      const over = !!info?.estimateMinutes && info.totalSeconds > info.estimateMinutes * 60;
                      return (
                        <li key={t.id} className="px-4 py-3 text-[14px]">
                          <div className="flex items-baseline justify-between gap-3">
                            <Link href={`/work?task=${t.id}`} className="min-w-0 truncate font-semibold text-[#131B30] hover:underline">{t.title}</Link>
                            <strong className="shrink-0 tabular-nums text-[#131B30]">{duration(t.seconds)}</strong>
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-muted-foreground">
                            <span>{clientName(t.slug)}</span>
                            {report.isOwner && <span>· {[...t.people].map(name).join(", ")}</span>}
                            {info?.estimateMinutes ? (
                              <span className={over ? "font-medium text-red-600" : ""}>· {duration(info.totalSeconds)} of {duration(info.estimateMinutes * 60)} estimated{over ? " (over)" : ""}</span>
                            ) : <span>· {duration(info?.totalSeconds || 0)} all-time</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </div>
          </>
        )}
      </main>

      {cell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#011421]/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && setCell(null)}>
          <div className="w-full max-w-[520px] rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-[#131B30]">{cell.title}</h2>
              <button onClick={() => setCell(null)} aria-label="Close" className="rounded-full p-1.5 hover:bg-slate-100"><X size={17} /></button>
            </div>
            <ul className="divide-y divide-border/60 text-[14px]">
              {cell.entries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/work?task=${e.taskId}`} className="font-medium text-[#131B30] hover:underline">{e.taskTitle}</Link>
                    <div className="text-[12px] text-muted-foreground">
                      {clientName(e.clientSlug)} · {new Date(e.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      {e.endedAt ? `–${new Date(e.endedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : " · running"}
                      {e.source === "manual" ? " · added by hand" : ""}{e.source === "auto_stopped" ? " · auto-stopped" : ""}{e.edited ? " · edited" : ""}
                    </div>
                    {e.note && <div className="text-[13px] text-[#3E4F5E]">{e.note}</div>}
                  </div>
                  <strong className="shrink-0 tabular-nums">{duration(e.seconds)}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function busiestDay(entries: Entry[]): string {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.day, (m.get(e.day) || 0) + e.seconds);
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? dayLabel(top[0]) : "—";
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white border border-[#1D475E]/[0.08] px-4 py-4 shadow-[0_1px_4px_rgba(29,71,94,0.06)]" title={hint}>
      <div className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tabular-nums text-[#131B30]">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-[#1D475E]/[0.08] shadow-[0_1px_4px_rgba(29,71,94,0.06)] overflow-hidden">
      <h2 className="border-b border-border/60 px-4 py-3 text-[16px] font-semibold text-[#131B30]">{title}</h2>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="px-4 py-6 text-[14px] text-muted-foreground">No time tracked this week.</p>;
}
