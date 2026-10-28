"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { BarChart3, Check, FilePlus2, Loader2, MessageSquare, Sparkles, Star, TrendingUp, Users } from "lucide-react";
import type { PortalChange, PortalReport, WinIcon } from "@/lib/portal";

// The client's own progress page, opened from their private link. Summary
// first, receipts below; every number is written for a practice owner, not
// a marketer. Built from /api/progress/[token].

const n = (v: number) => v.toLocaleString("en-US");
const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const day = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

const WIN_ICONS: Record<WinIcon, typeof TrendingUp> = { rank: TrendingUp, ai: Star, record: BarChart3, page: FilePlus2, impact: Sparkles, leads: Users };
const MARK = { improvement: "#2a78d6", page: "#4a3aa7", request: "#e87ba4" } as const;

export default function ProgressPage() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<PortalReport | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"month" | "start">("month");

  useEffect(() => {
    fetch(`/api/progress/${token}`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "This page isn't available.");
        setReport(json.report);
        setPreview(!!json.preview);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    if (report) document.title = `${report.client.name} · Your progress`;
  }, [report]);

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#F4F8F9] px-4">
        <div className="max-w-md text-center">
          <h1 className="font-headline text-[28px] text-[#001A2E]">This page isn&apos;t available</h1>
          <p className="mt-2 text-[15px] text-[#33505f]">{error}</p>
        </div>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#F4F8F9]">
        <div className="flex flex-col items-center gap-3 text-[#6b8591]">
          <Loader2 size={24} className="animate-spin text-[#0CA4C3]" />
          <p className="text-[14px]">Preparing your progress report…</p>
        </div>
      </div>
    );
  }

  const p = report.periods.find((x) => x.key === period) || report.periods[0];
  const tiles = [
    p.found && { label: p.found.label, value: n(p.found.value), delta: p.found.pct },
    p.leads && { label: "New leads from your website", value: n(p.leads.value), delta: p.leads.pct },
    p.pageOne && {
      label: "Searches where you're on Google's first page",
      value: n(p.pageOne.value),
      note: p.pageOne.gained && p.pageOne.gained > 0 ? `▲ ${p.pageOne.gained} new ${p.pageOne.gainedLabel}` : null,
    },
  ].filter(Boolean) as { label: string; value: string; delta?: number | null; note?: string | null }[];

  return (
    <div className="min-h-screen bg-[#F4F8F9] text-[#33505f] text-[15px] leading-relaxed">
      {preview && (
        <div className="bg-[#fdf3e2] text-[#a15c07] text-[13px] text-center py-2 px-4">
          Preview: only your MMG team can see this page until it&apos;s shared with the client.
        </div>
      )}

      {/* Top bar */}
      <header className="bg-white border-b border-[#dde8ec]">
        <div className="max-w-[1040px] mx-auto px-4 md:px-6 py-3.5 flex items-center gap-3.5 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {report.client.iconUrl ? (
              <span className="relative size-10 overflow-hidden rounded-[11px] shrink-0 bg-[#F4F8F9]">
                <Image src={report.client.iconUrl} alt="" fill sizes="40px" unoptimized={report.client.iconUrl.startsWith("data:")} className="object-cover" />
              </span>
            ) : (
              <span className="size-10 rounded-[11px] shrink-0 grid place-items-center bg-gradient-to-br from-[#01384C] to-[#0394B2] text-white font-bold text-[15px]">
                {report.client.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <strong className="block text-[16px] text-[#001A2E] truncate">{report.client.name}</strong>
              <span className="block text-[12.5px] text-[#6b8591] truncate">Your progress with MMG · {report.client.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
            </div>
          </div>
          <a href={report.reviewPath} className="ml-auto inline-flex items-center gap-2 rounded-[10px] bg-[#0CA4C3] hover:bg-[#0394B2] text-white px-3.5 py-2 text-[14px] font-semibold transition-colors">
            <MessageSquare size={15} /> Comment on your site
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-br from-[#001A2E] to-[#01384C] text-white">
        <div className="max-w-[1040px] mx-auto px-4 md:px-6 pt-10 pb-11 grid gap-6">
          <div className="flex justify-between gap-4 flex-wrap items-start">
            <div>
              <div className="text-[12px] font-semibold tracking-[0.14em] uppercase text-[#7fdcee]">{p.eyebrow}</div>
              <h1 className="font-headline text-[clamp(30px,4.6vw,46px)] leading-[1.08] mt-2.5 max-w-[20ch] text-balance">{p.headline}</h1>
              {p.lede && <p className="text-white/75 text-[17px] max-w-[62ch] mt-3">{p.lede}</p>}
            </div>
            <div className="flex gap-0.5 bg-white/[0.08] border border-white/15 rounded-[10px] p-[3px]" role="group" aria-label="Time period">
              {(["month", "start"] as const).map((k) => (
                <button
                  key={k}
                  aria-pressed={period === k}
                  onClick={() => setPeriod(k)}
                  className={`px-3 py-1.5 rounded-[7px] text-[13px] font-medium transition-colors ${period === k ? "bg-white/[0.16] text-white" : "text-white/75 hover:text-white"}`}
                >
                  {k === "month" ? "Last 30 days" : "Since we started"}
                </button>
              ))}
            </div>
          </div>
          {tiles.length > 0 && (
            <div className={`grid gap-3 grid-cols-1 ${tiles.length === 3 ? "md:grid-cols-3" : tiles.length === 2 ? "md:grid-cols-2" : ""}`}>
              {tiles.map((t) => (
                <div key={t.label} className="bg-white/[0.07] border border-white/[0.12] rounded-[14px] px-[18px] py-4 min-w-0">
                  <div className="text-[12.5px] text-white/70">{t.label}</div>
                  <div className="font-headline text-[40px] leading-[1.05] mt-1.5 tabular-nums">{t.value}</div>
                  {t.delta != null ? (
                    <div className={`text-[13px] mt-1.5 ${t.delta >= 0 ? "text-[#8ff0c4]" : "text-white/60"}`}>
                      {t.delta >= 0 ? "▲" : "▼"} {Math.abs(t.delta)}% {p.compareLabel}
                    </div>
                  ) : t.note ? (
                    <div className="text-[13px] mt-1.5 text-[#8ff0c4]">{t.note}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {p.value != null && p.valueNote && (
            <div className="flex gap-2.5 items-baseline flex-wrap border-t border-white/[0.12] pt-4">
              <b className="font-headline font-normal text-[26px] tabular-nums">≈ {money(p.value)}</b>
              <span className="text-white/70 text-[13.5px]">{p.valueNote}</span>
            </div>
          )}
        </div>
      </section>

      <main className="max-w-[1040px] mx-auto px-4 md:px-6 pt-7 pb-14 grid gap-[22px]">
        {report.wins.length > 0 && (
          <Section title="Recent wins" note="Picked out automatically from your rankings, traffic, and AI search results">
            <div className="grid gap-3 md:grid-cols-2">
              {report.wins.map((w) => {
                const Icon = WIN_ICONS[w.icon];
                return (
                  <article key={w.key} className="border border-[#dde8ec] rounded-[13px] p-4 grid grid-cols-[auto_1fr] gap-3">
                    <span className="size-[34px] rounded-[10px] grid place-items-center bg-[#e6f5ee] text-[#12805c]"><Icon size={17} /></span>
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold leading-snug text-[#001A2E]">{w.title}</h3>
                      <p className="text-[13.5px] mt-1">{w.detail}</p>
                      <div className="text-[12px] text-[#6b8591] mt-1.5">{day(w.day)}</div>
                    </div>
                  </article>
                );
              })}
            </div>
          </Section>
        )}

        {report.weekly.length >= 4 && (
          <Section title="Visits and what we changed" note="Weekly visits to your website. Each line is something we did; hover or tap one to see it.">
            <VisitsChart weekly={report.weekly} changes={report.changes} />
          </Section>
        )}

        {report.changes.length > 0 && (
          <Section title="What we did, and why" note="Every change to your site, and what it's done since">
            <div>
              {report.changes.map((c, i) => (
                <div key={c.key} className={`grid md:grid-cols-[88px_1fr] gap-1 md:gap-4 py-4 ${i ? "border-t border-[#dde8ec]" : "pt-1"}`}>
                  <div className="text-[13px] text-[#6b8591] pt-0.5">
                    <b className="md:block text-[15px] font-semibold text-[#001A2E] mr-1.5 md:mr-0">{day(c.day)}</b>
                    {day(c.day, { year: "numeric" })}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[15.5px] font-semibold text-[#001A2E]">
                      {c.title}
                      {c.kind !== "improvement" && <span className="ml-2 text-[11.5px] font-semibold tracking-[0.02em] text-[#6b8591]">{c.kind === "page" ? "NEW PAGE" : "YOUR REQUEST"}</span>}
                    </div>
                    {c.why && <p className="mt-1 text-[14px]"><span className="text-[#6b8591] font-medium">Why: </span>{c.why}</p>}
                    {c.result && (
                      <span className={`inline-flex items-center gap-1.5 mt-2.5 text-[13px] font-semibold rounded-full px-2.5 py-1 ${c.result.tone === "good" ? "bg-[#e6f5ee] text-[#12805c]" : "bg-[#e9f6f9] text-[#037c95]"}`}>
                        {c.result.tone === "good" && <Check size={13} />}
                        {c.result.text}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {report.rankings && report.rankings.rows.length > 0 && (
          <Section title="Your Google rankings" note="The searches that bring you patients, checked daily">
            <div className="flex gap-6 flex-wrap mb-4">
              <Stat value={n(report.rankings.pageOne)} label={report.rankings.pageOneAtStart != null ? `on page one (was ${report.rankings.pageOneAtStart} in ${day(report.rankings.trackedSince, { month: "long" })})` : "on page one"} />
              <Stat value={n(report.rankings.top3)} label="in the top 3" />
            </div>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[560px] border-collapse text-[14px]">
                <thead>
                  <tr className="text-left text-[11.5px] tracking-[0.08em] uppercase text-[#6b8591]">
                    <th className="font-semibold pb-2.5 px-2.5 border-b border-[#dde8ec]">Search</th>
                    <th className="font-semibold pb-2.5 px-2.5 border-b border-[#dde8ec]">Now</th>
                    <th className="font-semibold pb-2.5 px-2.5 border-b border-[#dde8ec]">At start</th>
                    <th className="font-semibold pb-2.5 px-2.5 border-b border-[#dde8ec]">Change</th>
                    <th className="font-semibold pb-2.5 px-2.5 border-b border-[#dde8ec]">Trend</th>
                    <th className="font-semibold pb-2.5 px-2.5 border-b border-[#dde8ec] text-right">Searches / mo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rankings.rows.map((r) => {
                    const gain = r.startPosition ? r.startPosition - r.position : null;
                    return (
                      <tr key={r.keyword} className="border-b border-[#dde8ec] last:border-0 text-[#001A2E]">
                        <td className="py-2.5 px-2.5">{r.keyword}</td>
                        <td className="py-2.5 px-2.5">
                          <span className={`inline-grid place-items-center min-w-[34px] h-[26px] rounded-lg font-bold text-[13px] tabular-nums ${r.position <= 3 ? "bg-[#e6f5ee] text-[#12805c]" : r.position <= 10 ? "bg-[#e9f6f9] text-[#037c95]" : "bg-[#F4F8F9] border border-[#dde8ec] text-[#33505f]"}`}>#{r.position}</span>
                        </td>
                        <td className="py-2.5 px-2.5 text-[#6b8591] tabular-nums">{r.startPosition ? `#${r.startPosition}` : "Not ranked"}</td>
                        <td className="py-2.5 px-2.5 font-semibold tabular-nums">
                          {gain == null ? <span className="text-[#12805c]">New</span> : gain > 0 ? <span className="text-[#12805c]">▲ {gain}</span> : gain < 0 ? <span className="text-[#6b8591] font-medium">▼ {-gain}</span> : <span className="text-[#6b8591] font-medium">Holding</span>}
                        </td>
                        <td className="py-2.5 px-2.5"><Spark history={r.history} /></td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums">{r.volume ? n(r.volume) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {(report.requests.length > 0 || report.ai) && (
          <div className={`grid gap-[22px] ${report.requests.length > 0 && report.ai ? "md:grid-cols-[1.35fr_1fr]" : ""}`}>
            {report.requests.length > 0 && (
              <Section title="Your requests" note="From comments you left on your site">
                <div className="grid gap-2.5">
                  {report.requests.map((r) => (
                    <div key={r.id} className="border border-[#dde8ec] rounded-[13px] px-3.5 py-3">
                      <div className="flex gap-2 items-center flex-wrap">
                        <span className={`text-[11.5px] font-bold rounded-full px-2 py-0.5 tracking-[0.02em] ${r.status === "resolved" ? "bg-[#e6f5ee] text-[#12805c]" : r.status === "in_progress" ? "bg-[#fdf3e2] text-[#a15c07]" : "bg-[#e9f6f9] text-[#037c95]"}`}>
                          {r.status === "resolved" ? "RESOLVED" : r.status === "in_progress" ? "IN PROGRESS" : "RECEIVED"}
                        </span>
                        <span className="text-[12.5px] text-[#6b8591]">{day(r.day)}</span>
                      </div>
                      <p className="text-[#001A2E] font-semibold text-[14.5px] mt-1.5">“{r.body}”</p>
                      {r.reply && <p className="text-[13.5px] mt-1"><b className="text-[#001A2E]">MMG:</b> {r.reply}</p>}
                      <div className="text-[12px] text-[#6b8591] mt-1.5 flex gap-3 flex-wrap">
                        <a href={r.link} className="text-[#037c95] font-medium hover:underline">{r.status === "resolved" ? "See it on your site" : "See the comment"} →</a>
                        <span>{r.page} · {r.device.charAt(0).toUpperCase() + r.device.slice(1)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {report.ai && (
              <Section title="AI search" note="Do AI assistants recommend you?">
                <div className="flex items-baseline gap-2.5 flex-wrap">
                  <b className="font-headline font-normal text-[44px] text-[#001A2E] tabular-nums">{report.ai.mentioned} of {report.ai.total}</b>
                  <span className="text-[#6b8591] text-[13.5px]">patient questions we track get an answer that mentions you</span>
                </div>
                <div className="grid gap-2 mt-3">
                  {report.ai.rows.map((r) => (
                    <div key={r.prompt} className="grid grid-cols-[1fr_auto] gap-2.5 text-[13.5px] px-3 py-2 rounded-[10px] bg-[#F4F8F9]">
                      <span className="min-w-0">“{r.prompt}”</span>
                      {r.engines.length ? <span className="text-[#12805c] font-semibold whitespace-nowrap">{r.engines[0]} ✓</span> : <span className="text-[#6b8591] whitespace-nowrap">Not yet</span>}
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-[#dde8ec]">
        <div className="max-w-[1040px] mx-auto px-4 md:px-6 py-5 flex gap-4 justify-between flex-wrap text-[13px] text-[#6b8591]">
          <span>Prepared by your team at MMG Studio · Updated {new Date(report.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          <span>Powered by MMG Pulse</span>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#dde8ec] rounded-2xl px-[22px] pt-[22px] pb-6 min-w-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <h2 className="font-headline text-[26px] text-[#001A2E] leading-tight">{title}</h2>
        {note && <p className="text-[#6b8591] text-[13.5px]">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <b className="block font-headline font-normal text-[30px] leading-[1.1] text-[#001A2E] tabular-nums">{value}</b>
      <span className="text-[13px] text-[#6b8591]">{label}</span>
    </div>
  );
}

// Position trend; up is better, so #1 sits at the top.
function Spark({ history }: { history: (number | null)[] }) {
  const max = Math.max(12, ...history.filter((h): h is number => h != null)) + 2;
  const pts = history.map((v, i) => (v == null ? null : [i * 15, 2 + (v / max) * 20] as const)).filter(Boolean) as (readonly [number, number])[];
  if (pts.length < 2) return <span className="text-[#6b8591] text-[12px]">—</span>;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="-3 0 96 24" className="w-[90px] h-6" aria-hidden="true">
      <path d={pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1].toFixed(1)}`).join(" ")} fill="none" stroke="#0CA4C3" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.8} fill="#0CA4C3" />
    </svg>
  );
}

function VisitsChart({ weekly, changes }: { weekly: PortalReport["weekly"]; changes: PortalChange[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const W = 900, H = 260, L = 44, R = 14, T = 26, B = 30;
  const first = weekly[0].week;
  const span = weekly.length - 1;
  const top = useMemo(() => {
    const m = Math.max(...weekly.map((w) => w.visits), 10);
    const step = 10 ** Math.floor(Math.log10(m));
    return Math.ceil((m * 1.1) / step) * step;
  }, [weekly]);
  const x = (i: number) => L + (i / span) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const weekIndex = (d: string) => (new Date(`${d}T12:00:00Z`).getTime() - new Date(`${first}T12:00:00Z`).getTime()) / (7 * 86_400_000);

  // Changes on the same week share one pin.
  const byWeek = new Map<number, PortalChange[]>();
  for (const c of changes) {
    const i = weekIndex(c.day);
    if (i < 0 || i > span + 1) continue;
    const k = Math.min(span, Math.round(i));
    byWeek.set(k, [...(byWeek.get(k) || []), c]);
  }
  const pins = [...byWeek].sort((a, b) => a[0] - b[0]);

  const line = weekly.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(w.visits).toFixed(1)}`).join(" ");
  const months = weekly
    .map((w, i) => ({ i, m: w.week.slice(0, 7) }))
    .filter((w, idx, arr) => idx === 0 || w.m !== arr[idx - 1].m)
    .filter((w, idx, arr) => w.i <= span - 1 && (idx === arr.length - 1 || arr[idx + 1].i - w.i >= 2));
  const peak = weekly.reduce((best, w, i) => (w.visits > weekly[best].visits ? i : best), 0);
  const active = pins.find(([i]) => i === open);
  const ticks = [0, top / 3, (2 * top) / 3, top].map((v) => Math.round(v));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={`Weekly website visits over the last ${weekly.length} weeks, with ${changes.length} site changes marked`}>
        <defs>
          <linearGradient id="visits-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0CA4C3" stopOpacity={0.24} />
            <stop offset="100%" stopColor="#0CA4C3" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#dde8ec" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#6b8591">{n(v)}</text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m.m} x={x(m.i)} y={H - 8} textAnchor="start" fontSize={11} fill="#6b8591">{day(`${m.m}-01`, { month: "short" })}</text>
        ))}
        <path d={`${line} L${x(span)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="url(#visits-fill)" />
        <path d={line} fill="none" stroke="#0CA4C3" strokeWidth={2.4} strokeLinejoin="round" />
        <circle cx={x(peak)} cy={y(weekly[peak].visits)} r={4.5} fill="#0CA4C3" stroke="#fff" strokeWidth={2} />
        <text x={x(peak) + (peak > span / 2 ? -8 : 8)} y={y(weekly[peak].visits) - 10} textAnchor={peak > span / 2 ? "end" : "start"} fontSize={12} fontWeight={600} fill="#001A2E">
          {n(weekly[peak].visits)} visits, best week
        </text>
        {pins.map(([i, items]) => {
          const color = items.length === 1 ? MARK[items[0].kind] : "#001A2E";
          return (
            <g
              key={i}
              role="button"
              tabIndex={0}
              aria-label={items.map((c) => `${day(c.day)}: ${c.title}`).join("; ")}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setOpen(i)}
              onMouseLeave={() => setOpen(null)}
              onFocus={() => setOpen(i)}
              onBlur={() => setOpen(null)}
              onClick={() => setOpen(open === i ? null : i)}
            >
              <line x1={x(i)} x2={x(i)} y1={T - 6} y2={y(0)} stroke={color} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.8} />
              <rect x={x(i) - 12} y={T - 20} width={24} height={H - B - T + 20} fill="transparent" />
              <circle cx={x(i)} cy={T - 8} r={9} fill={color} stroke="#fff" strokeWidth={2} />
              <text x={x(i)} y={T - 4.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">{items.length > 1 ? items.length : "•"}</text>
            </g>
          );
        })}
      </svg>
      {active && (
        <div
          className="absolute top-8 w-[260px] bg-white border border-[#dde8ec] rounded-xl p-3 shadow-[0_12px_32px_rgba(0,26,46,0.16)] text-[13px] pointer-events-none z-10"
          style={{ left: `clamp(0px, calc(${(x(active[0]) / W) * 100}% - 130px), calc(100% - 260px))` }}
        >
          <div className="grid gap-2.5">
            {active[1].map((c) => (
              <div key={c.key}>
                <span className="text-[12px] text-[#6b8591]">{day(c.day)}</span>
                <b className="block text-[13.5px] text-[#001A2E] leading-snug">{c.title}</b>
                {c.result && <div className={`mt-1 font-semibold ${c.result.tone === "good" ? "text-[#12805c]" : "text-[#037c95]"}`}>{c.result.text}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-4 flex-wrap text-[12.5px] text-[#6b8591] mt-2.5">
        <span><i className="inline-block size-[9px] rounded-full mr-1.5" style={{ background: MARK.improvement }} />Page improvements</span>
        <span><i className="inline-block size-[9px] rounded-full mr-1.5" style={{ background: MARK.page }} />New pages</span>
        <span><i className="inline-block size-[9px] rounded-full mr-1.5" style={{ background: MARK.request }} />Your requests</span>
      </div>
    </div>
  );
}
