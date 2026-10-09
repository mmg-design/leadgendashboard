"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownRight,
  CalendarRange,
  Check,
  ChevronDown,
  Clipboard,
  FileText,
  Loader2,
  Sparkles,
  TrendingUp,
  Search,
  WandSparkles,
} from "lucide-react";

type ReportMode = "comparison" | "single" | "prompt-only";
type DailyPoint = { range: "pre" | "post" | "single"; date: string; sessions: number; pageviews: number; engagedSessions: number; topPages?: Array<{ page: string; views: number }> };
type VisibilityPoint = { range: "pre" | "post" | "outside"; date: string; score: number };
type GeneratedReport = {
  sections: Array<{ key: string; title: string; summary: string; insights: Array<{ label: string; value: string; explanation: string }> }>;
  beforeAfter: { before: { title: string; points: string[] }; after: { title: string; points: string[] }; differentiators: string[] };
  recommendations: Array<{ title: string; action: string; why: string }>;
  context: string[];
};
type Result = {
  report?: GeneratedReport;
  prompt?: string;
  data?: {
    ga?: { summary?: { pre?: Record<string, number>; post?: Record<string, number>; single?: Record<string, number>; changes?: Record<string, number | null> }; daily?: DailyPoint[] };
    seranking?: { summary?: { pre?: Record<string, number | null>; post?: Record<string, number | null>; single?: Record<string, number | null> }; visibilityHistory?: VisibilityPoint[] };
  };
  availability?: Record<string, string>;
  limitations?: string[];
  effectiveRanges?: { pre?: { start: string; end: string }; post?: { start: string; end: string }; range?: { start: string; end: string } };
  error?: string;
};

// Before = muted slate, after = brand teal: "after" is the period people care about.
const BEFORE = "#8FA3AD";
const AFTER = "#0CA4C3";

const MODES: { value: ReportMode; title: string; description: string; icon: React.ReactNode }[] = [
  { value: "comparison", title: "Compare two periods", description: "Before vs. after a launch, campaign, or redesign.", icon: <ArrowLeftRight size={17} /> },
  { value: "single", title: "One date range", description: "Summarize what happened over a single stretch of time.", icon: <CalendarRange size={17} /> },
  { value: "prompt-only", title: "Prompt only", description: "Write a reusable AI prompt without pulling any data.", icon: <WandSparkles size={17} /> },
];

const STARTERS: { label: string; query: string }[] = [
  {
    label: "Launch impact",
    query: "Analyze website performance in the two months before launch and the two months after launch. Use Google Analytics and SE Ranking. Explain changes in traffic, acquisition, content performance, search visibility, keyword rankings, and the metrics we track. Identify material insights and recommended next steps without assuming the launch caused every change.",
  },
  {
    label: "SEO progress",
    query: "How has search visibility changed over this period? Which keywords moved the most, which pages gained or lost organic traffic, and what should we prioritize next to rank higher?",
  },
  {
    label: "Where leads come from",
    query: "Which traffic sources and pages are producing engaged visitors and conversions? Where are we losing people, and which channels deserve more investment?",
  },
  {
    label: "Content performance",
    query: "Which pages and blog posts are pulling their weight? Show what's gaining traffic, what's flat, and which content to update, consolidate, or promote.",
  },
];

function inclusiveDays(start: string, end: string) {
  return Math.max(Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1, 0);
}

function defaultDates() {
  const today = new Date();
  const postEnd = new Date(today);
  const postStart = new Date(today); postStart.setDate(postStart.getDate() - 59);
  const preEnd = new Date(postStart); preEnd.setDate(preEnd.getDate() - 1);
  const preStart = new Date(preEnd); preStart.setDate(preStart.getDate() - 59);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  return { preStart: fmt(preStart), preEnd: fmt(preEnd), postStart: fmt(postStart), postEnd: fmt(postEnd), singleStart: fmt(postStart), singleEnd: fmt(postEnd) };
}

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const inputClass =
  "mt-1.5 block w-full rounded-lg border border-border bg-white px-3 py-2 text-[15px] text-foreground focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/25 focus:border-[#0CA4C3]/40";

function StepHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <span className="size-6 shrink-0 rounded-full bg-[#001A2E] text-white text-[12px] font-semibold flex items-center justify-center translate-y-[-1px]">{n}</span>
      <div>
        <p className="text-[16px] font-semibold text-[#001A2E]">{title}</p>
        {hint && <p className="text-[13px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function PeriodPicker({ label, color, start, end, onStart, onEnd }: {
  label: string;
  color: string;
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}) {
  const days = inclusiveDays(start, end);
  return (
    <div className="rounded-xl border border-border bg-[#f7fafb] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-[#001A2E]">
          <span className="size-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="rounded-full bg-white border border-border px-2 py-0.5 text-[12px] font-medium tabular-nums text-muted-foreground">
          {days} days
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[13px] text-muted-foreground">Start<input type="date" value={start} onChange={(e) => onStart(e.target.value)} className={inputClass} /></label>
        <label className="text-[13px] text-muted-foreground">End<input type="date" value={end} onChange={(e) => onEnd(e.target.value)} className={inputClass} /></label>
      </div>
    </div>
  );
}

function ChangePill({ change }: { change: number | null }) {
  if (change == null) return <span className="text-[13px] text-muted-foreground">No baseline to compare</span>;
  const up = change >= 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold ${up ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {up ? "+" : ""}{change.toFixed(1)}%
    </span>
  );
}

function MetricComparison({ label, pre, post }: { label: string; pre?: number | null; post?: number | null }) {
  const change = pre && post != null ? ((post - pre) / pre) * 100 : null;
  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between gap-2">
          <p className={eyebrow}>{label}</p>
          <ChangePill change={change} />
        </div>
        <div className="mt-4 flex items-end gap-6">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><span className="size-2 rounded-full" style={{ background: BEFORE }} />Before</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums text-[#001A2E]/55">{pre == null ? "—" : pre.toLocaleString()}</p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><span className="size-2 rounded-full" style={{ background: AFTER }} />After</p>
            <p className="mt-1 text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#001A2E]">{post == null ? "—" : post.toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricSingle({ label, value, days }: { label: string; value?: number | null; days: number }) {
  return (
    <Card>
      <CardContent>
        <p className={eyebrow}>{label}</p>
        <p className="mt-4 text-[36px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#001A2E]">{value == null ? "—" : value.toLocaleString()}</p>
        <p className="mt-3 text-[13px] text-muted-foreground">Total over {days} days</p>
      </CardContent>
    </Card>
  );
}

type ChartRow = { date: string; before: number | null; after: number | null; topPages?: DailyPoint["topPages"] };

function ReportChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ dataKey: string; value: number | null; payload: ChartRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const value = row.after ?? row.before;
  const isBefore = row.after == null;
  return (
    <div className="max-w-[280px] rounded-xl border border-border bg-white px-3.5 py-3 text-[13px] shadow-[0_8px_24px_rgba(0,26,46,0.12)]">
      <div className="flex items-center justify-between gap-4">
        <span className="font-semibold text-[#001A2E]">{shortDate(row.date)}</span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: isBefore ? BEFORE : AFTER }} />
          {value?.toLocaleString()} sessions
        </span>
      </div>
      {!!row.topPages?.length && (
        <div className="mt-2.5 pt-2.5 border-t border-border">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1">Most-viewed pages</p>
          {row.topPages.map((page) => (
            <p key={page.page} className="flex justify-between gap-3 text-foreground/75">
              <span className="truncate">{page.page}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{page.views}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartCard({ icon, title, subtitle, children, legend }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode; legend?: boolean }) {
  return (
    <Card>
      <CardContent>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[#097388]/75">{icon}</span>
              <p className="font-headline text-[22px] text-[#001A2E]">{title}</p>
            </div>
            <p className="mt-0.5 text-[14px] text-muted-foreground">{subtitle}</p>
          </div>
          {legend && (
            <div className="flex gap-4 text-[13px] text-foreground/80">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: BEFORE }} />Before</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: AFTER }} />After</span>
            </div>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

const axisTick = { fill: "#365f6d", fontSize: 12 };

function ReportSectionCard({ section }: { section: GeneratedReport["sections"][number] }) {
  return (
    <Card className="h-full">
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-headline text-[22px] text-[#001A2E]">{section.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-foreground/75">{section.summary}</p>
        </div>
        {!!section.insights?.length && (
          <div className="divide-y divide-border/70 border-t border-border/70">
            {section.insights.map((insight, index) => (
              <details key={`${insight.label}-${index}`} className="group py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <span className="text-[14px] font-medium text-foreground/85">{insight.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold tabular-nums text-[#001A2E] text-right">{insight.value}</span>
                    <ChevronDown size={14} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{insight.explanation}</p>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BeforeAfter({ report }: { report: GeneratedReport }) {
  const periods = [
    { data: report.beforeAfter?.before, color: BEFORE },
    { data: report.beforeAfter?.after, color: AFTER },
  ].filter((p) => p.data);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {periods.map(({ data, color }, index) => (
          <Card key={index} className="relative">
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
            <CardContent>
              <p className="font-headline text-[22px] text-[#001A2E]">{data!.title}</p>
              <ul className="mt-4 space-y-2.5">
                {data!.points?.map((point) => (
                  <li key={point} className="flex gap-2.5 text-[15px] leading-relaxed text-foreground/80">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full" style={{ background: color }} />
                    {point}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
      {!!report.beforeAfter?.differentiators?.length && (
        <Card>
          <CardContent>
            <p className="font-headline text-[22px] text-[#001A2E]">What changed</p>
            <div className="mt-4 grid gap-x-8 gap-y-2.5 md:grid-cols-2">
              {report.beforeAfter.differentiators.map((item) => (
                <p key={item} className="flex gap-2.5 text-[15px] leading-relaxed text-foreground/80">
                  <Check size={15} className="mt-1 shrink-0 text-[#0CA4C3]" />
                  {item}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function CustomReportGenerator({ clientSlug, clientName }: { clientSlug: string; clientName: string }) {
  const defaults = useMemo(defaultDates, []);
  const [mode, setMode] = useState<ReportMode>("comparison");
  const [dates, setDates] = useState(defaults);
  const [query, setQuery] = useState(STARTERS[0].query);
  const [sources, setSources] = useState({ ga: true, seranking: true });
  const [loading, setLoading] = useState<"report" | "prompt" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(output: "report" | "prompt") {
    setLoading(output);
    setResult(null);
    try {
      const response = await fetch("/api/custom-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientSlug, query, output, mode,
          ...(mode === "comparison" ? { pre: { start: dates.preStart, end: dates.preEnd }, post: { start: dates.postStart, end: dates.postEnd } } : {}),
          ...(mode === "single" ? { range: { start: dates.singleStart, end: dates.singleEnd } } : {}),
          sources: mode === "prompt-only" ? [] : Object.entries(sources).filter(([, enabled]) => enabled).map(([source]) => source),
        }),
      });
      const data = await response.json();
      setResult(data);
    } catch {
      setResult({ error: "The report request failed." });
    } finally {
      setLoading(null);
    }
  }

  async function copyPrompt() {
    if (!result?.prompt) return;
    await navigator.clipboard.writeText(result.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const ga = result?.data?.ga;
  const se = result?.data?.seranking;
  const comparing = mode === "comparison";
  const chartData: ChartRow[] = (ga?.daily || []).map((point) => ({
    date: point.date,
    before: point.range === "pre" ? point.sessions : null,
    after: point.range === "pre" ? null : point.sessions,
    topPages: point.topPages,
  }));
  const visibilityData = (se?.visibilityHistory || []).map((p) => ({
    date: p.date,
    before: p.range === "pre" ? p.score : null,
    after: p.range === "pre" ? null : p.score,
  }));
  const singleDays = inclusiveDays(result?.effectiveRanges?.range?.start || dates.singleStart, result?.effectiveRanges?.range?.end || dates.singleEnd);
  const setDate = (key: keyof typeof dates) => (value: string) => setDates((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-8">
      <div className="px-1">
        <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0394B2] mb-1.5">Custom reports · {clientName}</div>
        <h2 className="font-headline text-[28px] text-[#001A2E]">Report generator</h2>
        <p className="mt-1 text-[15px] text-muted-foreground max-w-2xl">
          Ask a question about the site and get a written report built from the client&apos;s Google Analytics and SE Ranking data, or a reusable prompt to take anywhere.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-8">
          <section>
            <StepHeading n={1} title="What kind of report?" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {MODES.map((m) => {
                const active = mode === m.value;
                return (
                  <button
                    key={m.value}
                    onClick={() => { setMode(m.value); setResult(null); }}
                    className={`text-left rounded-xl border p-4 transition-colors ${active ? "border-[#0CA4C3] bg-[#0CA4C3]/[0.06] ring-1 ring-[#0CA4C3]" : "border-border bg-white hover:border-[#001A2E]/25"}`}
                  >
                    <span className={`size-9 rounded-xl flex items-center justify-center ${active ? "bg-[#0CA4C3] text-white" : "bg-[#001A2E]/[0.05] text-[#001A2E]/70"}`}>{m.icon}</span>
                    <p className="mt-3 text-[15px] font-semibold text-[#001A2E]">{m.title}</p>
                    <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{m.description}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {mode !== "prompt-only" && (
            <section>
              <StepHeading
                n={2}
                title={comparing ? "Which periods?" : "Which dates?"}
                hint={comparing ? "Pick the stretch before the change and the stretch after it." : undefined}
              />
              {comparing ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <PeriodPicker label="Before" color={BEFORE} start={dates.preStart} end={dates.preEnd} onStart={setDate("preStart")} onEnd={setDate("preEnd")} />
                  <PeriodPicker label="After" color={AFTER} start={dates.postStart} end={dates.postEnd} onStart={setDate("postStart")} onEnd={setDate("postEnd")} />
                </div>
              ) : (
                <div className="max-w-xl">
                  <PeriodPicker label="Date range" color={AFTER} start={dates.singleStart} end={dates.singleEnd} onStart={setDate("singleStart")} onEnd={setDate("singleEnd")} />
                </div>
              )}
            </section>
          )}

          <section>
            <StepHeading n={mode === "prompt-only" ? 2 : 3} title="What should it answer?" hint="Start from an example or write your own." />
            <div className="flex flex-wrap gap-2 mb-3">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setQuery(s.query)}
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${query === s.query ? "border-[#001A2E] bg-[#001A2E] text-white" : "border-border bg-white text-foreground/75 hover:border-[#001A2E]/30"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={5}
              className="w-full resize-y rounded-xl border border-border bg-white px-4 py-3 text-[15px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/25 focus:border-[#0CA4C3]/40"
            />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
            {mode !== "prompt-only" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground mr-1">Data from</span>
                {([["ga", "Google Analytics 4", <TrendingUp key="ga" size={13} />], ["seranking", "SE Ranking", <Search key="se" size={13} />]] as const).map(([key, label, icon]) => (
                  <label
                    key={key}
                    className={`cursor-pointer inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${sources[key] ? "border-[#0CA4C3]/40 bg-[#0CA4C3]/10 text-[#01384C]" : "border-border text-muted-foreground"}`}
                  >
                    <input type="checkbox" checked={sources[key]} onChange={(e) => setSources((current) => ({ ...current, [key]: e.target.checked }))} className="sr-only" />
                    {sources[key] ? <Check size={13} /> : icon}
                    {label}
                  </label>
                ))}
              </div>
            ) : (
              <span className="text-[13px] text-muted-foreground">No analytics are pulled in prompt-only mode.</span>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => run("prompt")}
                disabled={loading !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-[14px] font-semibold text-[#001A2E] hover:bg-[#001A2E]/[0.03] disabled:opacity-50 transition-colors"
              >
                {loading === "prompt" ? <Loader2 size={15} className="animate-spin" /> : <Clipboard size={15} />}
                Generate prompt
              </button>
              {mode !== "prompt-only" && (
                <button
                  onClick={() => run("report")}
                  disabled={loading !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#001A2E] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#01384C] disabled:opacity-50 transition-colors"
                >
                  {loading === "report" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  Generate report
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center text-center">
            <Loader2 size={22} className="animate-spin text-[#0CA4C3]" />
            <p className="mt-3 text-[16px] font-semibold text-[#001A2E]">
              {loading === "report" ? "Pulling the data and writing the report…" : "Writing the prompt…"}
            </p>
            <p className="mt-1 text-[14px] text-muted-foreground">This can take up to a minute.</p>
          </CardContent>
        </Card>
      )}

      {result?.error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[15px] text-red-700">{result.error}</div>}

      {result && !result.error && (
        <div className="space-y-6">
          <div className="px-1 flex items-center gap-2">
            <FileText size={16} className="text-[#097388]/75" />
            <h3 className="font-headline text-[26px] text-[#001A2E]">Results</h3>
          </div>

          {ga?.summary && comparing && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <MetricComparison label="Sessions" pre={ga.summary.pre?.sessions} post={ga.summary.post?.sessions} />
              <MetricComparison label="Pageviews" pre={ga.summary.pre?.pageviews} post={ga.summary.post?.pageviews} />
              <MetricComparison label="Users" pre={ga.summary.pre?.users} post={ga.summary.post?.users} />
            </div>
          )}
          {ga?.summary?.single && mode === "single" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <MetricSingle label="Sessions" value={ga.summary.single.sessions} days={singleDays} />
              <MetricSingle label="Pageviews" value={ga.summary.single.pageviews} days={singleDays} />
              <MetricSingle label="Users" value={ga.summary.single.users} days={singleDays} />
            </div>
          )}

          {chartData.length > 0 && (
            <ChartCard icon={<TrendingUp size={16} />} title="Traffic by day" subtitle="Sessions per day. Hover a day for its most-viewed pages." legend={comparing}>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="reportBefore" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BEFORE} stopOpacity={0.3} /><stop offset="100%" stopColor={BEFORE} stopOpacity={0.02} /></linearGradient>
                      <linearGradient id="reportAfter" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={AFTER} stopOpacity={0.32} /><stop offset="100%" stopColor={AFTER} stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="rgba(0,26,46,0.06)" />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} axisLine={{ stroke: "rgba(0,26,46,0.1)" }} tickLine={false} minTickGap={32} dy={6} />
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
                    <Tooltip content={<ReportChartTooltip />} cursor={{ stroke: "rgba(0,26,46,0.25)" }} wrapperStyle={{ outline: "none" }} />
                    {comparing && <ReferenceLine x={dates.postStart} stroke="#001A2E" strokeOpacity={0.4} strokeDasharray="4 4" label={{ value: "After starts", position: "insideTopLeft", fill: "#365f6d", fontSize: 12 }} />}
                    <Area type="monotone" dataKey="before" stroke={BEFORE} strokeWidth={2} fill="url(#reportBefore)" connectNulls={false} />
                    <Area type="monotone" dataKey="after" stroke={AFTER} strokeWidth={2} fill="url(#reportAfter)" connectNulls={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {visibilityData.length > 0 && (
            <ChartCard icon={<Search size={16} />} title="Search visibility" subtitle="SE Ranking's visibility score. Higher means the site is easier to find." legend={comparing}>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={visibilityData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="rgba(0,26,46,0.06)" />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={axisTick} axisLine={{ stroke: "rgba(0,26,46,0.1)" }} tickLine={false} minTickGap={32} dy={6} />
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} />
                    <Tooltip
                      labelFormatter={(d) => shortDate(String(d))}
                      contentStyle={{ borderRadius: 12, border: "1px solid #d9e9ed", boxShadow: "0 8px 24px rgba(0,26,46,0.12)", fontSize: 13 }}
                    />
                    {comparing && <ReferenceLine x={dates.postStart} stroke="#001A2E" strokeOpacity={0.4} strokeDasharray="4 4" />}
                    <Line type="monotone" dataKey="before" name="Before" stroke={BEFORE} strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="after" name={comparing ? "After" : "Visibility"} stroke={AFTER} strokeWidth={2} dot={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          )}

          {result.report && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {result.report.sections?.map((section) => <ReportSectionCard key={section.key} section={section} />)}
              </div>

              {comparing && <BeforeAfter report={result.report} />}

              {!!result.report.recommendations?.length && (
                <Card>
                  <CardContent>
                    <p className="font-headline text-[22px] text-[#001A2E]">Recommended next steps</p>
                    <ol className="mt-4 divide-y divide-border/70">
                      {result.report.recommendations.map((item, i) => (
                        <li key={item.title} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                          <span className="size-7 shrink-0 rounded-full bg-[#0CA4C3]/10 text-[#0394B2] text-[13px] font-semibold flex items-center justify-center">{i + 1}</span>
                          <div>
                            <p className="text-[15px] font-semibold text-[#001A2E]">{item.title}</p>
                            <p className="mt-1 text-[14px] leading-relaxed text-foreground/80">{item.action}</p>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground"><span className="font-medium text-foreground/65">Why:</span> {item.why}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}

              <details className="group rounded-2xl border border-border bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-[14px] font-semibold text-[#001A2E]">
                  Supporting context and data limits
                  <ChevronDown size={15} className="text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-border px-6 py-4 space-y-2">
                  {[...(result.report.context || []), ...(result.limitations || [])].map((item) => (
                    <p key={item} className="text-[13px] leading-relaxed text-muted-foreground">• {item}</p>
                  ))}
                </div>
              </details>
            </div>
          )}

          {result.prompt && (
            <Card>
              <CardContent>
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <p className="font-headline text-[22px] text-[#001A2E]">Reusable prompt</p>
                    <p className="text-[14px] text-muted-foreground">Paste into Claude, ChatGPT, or Gemini. The data is already included.</p>
                  </div>
                  <button
                    onClick={copyPrompt}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[13px] font-semibold text-[#001A2E] hover:bg-[#001A2E]/[0.03] transition-colors"
                  >
                    {copied ? <Check size={14} /> : <Clipboard size={14} />} {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="max-h-[380px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#001A2E] p-5 text-[12.5px] leading-relaxed text-white/80">{result.prompt}</pre>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
