"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Check, ChevronDown, Clipboard, Info, Loader2, Sparkles } from "lucide-react";

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
  error?: string;
};

const EXAMPLE_QUERY = `Analyze website performance in the two months before launch and the two months after launch. Use Google Analytics, SE Ranking, and Microsoft Clarity. Explain changes in traffic, engagement, acquisition, content performance, search visibility, keyword rankings, and the metrics we track. Identify material insights and recommended next steps without assuming the launch caused every change.`;

function defaultDates() {
  const today = new Date();
  const postEnd = new Date(today);
  const postStart = new Date(today); postStart.setDate(postStart.getDate() - 59);
  const preEnd = new Date(postStart); preEnd.setDate(preEnd.getDate() - 1);
  const preStart = new Date(preEnd); preStart.setDate(preStart.getDate() - 59);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  return { preStart: fmt(preStart), preEnd: fmt(preEnd), postStart: fmt(postStart), postEnd: fmt(postEnd), singleStart: fmt(postStart), singleEnd: fmt(postEnd) };
}

function MetricComparison({ label, pre, post, suffix = "" }: { label: string; pre?: number | null; post?: number | null; suffix?: string }) {
  const change = pre && post != null ? ((post - pre) / pre) * 100 : null;
  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="flex items-center gap-1"><p className="text-[11px] uppercase tracking-[0.1em] text-[#097388]/75 font-semibold">{label}</p><PlainTooltip text={`${label} in the first period compared with the second period.`} /></div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div><p className="text-[11px] text-muted-foreground">Pre</p><p className="font-headline text-[25px] text-[#001A2E]">{pre == null ? "—" : `${pre.toLocaleString()}${suffix}`}</p></div>
          <div className="text-right"><p className="text-[11px] text-muted-foreground">Post</p><p className="font-headline text-[25px] text-[#001A2E]">{post == null ? "—" : `${post.toLocaleString()}${suffix}`}</p></div>
        </div>
        <p className={`mt-2 text-[12px] font-medium ${change == null ? "text-muted-foreground" : change >= 0 ? "text-emerald-700" : "text-amber-700"}`}>{change == null ? "No comparable baseline" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</p>
      </CardContent>
    </Card>
  );
}

function MetricSingle({ label, value, suffix = "" }: { label: string; value?: number | null; suffix?: string }) {
  return <Card className="py-0"><CardContent className="p-4"><p className="text-[11px] uppercase tracking-[0.1em] text-[#097388]/75 font-semibold">{label}</p><p className="mt-2 font-headline text-[29px] text-[#001A2E]">{value == null ? "—" : `${value.toLocaleString()}${suffix}`}</p></CardContent></Card>;
}

function PlainTooltip({ text }: { text: string }) {
  return <span className="relative group/tip inline-flex"><Info size={12} className="text-[#097388]/45 cursor-help" /><span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-56 -translate-x-1/2 rounded-lg bg-[#001A2E] px-3 py-2 text-[12px] font-normal normal-case tracking-normal text-white shadow-xl group-hover/tip:block">{text}</span></span>;
}

function ReportSectionCard({ section }: { section: GeneratedReport["sections"][number] }) {
  return <Card className="py-0 h-full"><CardContent className="p-5 space-y-4"><div><div className="flex items-center gap-2"><h3 className="font-headline text-[22px] text-[#001A2E]">{section.title}</h3><PlainTooltip text={`This card explains ${section.title.toLowerCase()} in simple terms.`} /></div><p className="mt-1 text-[13px] leading-relaxed text-foreground/65">{section.summary}</p></div><div className="space-y-3">{section.insights?.map((insight, index) => <div key={`${insight.label}-${index}`} className="rounded-lg bg-muted/30 p-3"><div className="flex items-center justify-between gap-3"><p className="text-[12px] font-semibold text-[#001A2E]">{insight.label}</p><p className="text-[13px] font-semibold text-[#0394B2] text-right">{insight.value}</p></div><p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{insight.explanation}</p></div>)}</div></CardContent></Card>;
}

function ReportChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string; payload: DailyPoint }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return <div className="max-w-[270px] rounded-lg border border-border bg-white p-3 text-[12px] shadow-xl"><p className="font-semibold text-[#001A2E]">{point.date}</p>{payload.map((item) => <p key={item.dataKey} style={{ color: item.color }} className="mt-1 capitalize">{item.dataKey}: {item.value.toLocaleString()}</p>)}{!!point.topPages?.length && <div className="mt-2 border-t border-border/70 pt-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Most-viewed pages</p>{point.topPages.map((page) => <p key={page.page} className="mt-1 flex justify-between gap-3 text-foreground/75"><span className="truncate">{page.page}</span><span className="shrink-0 text-muted-foreground">{page.views} views</span></p>)}</div>}</div>;
}

function BeforeAfter({ report }: { report: GeneratedReport }) {
  const periods = [report.beforeAfter?.before, report.beforeAfter?.after].filter(Boolean);
  return <div className="space-y-3"><div className="grid grid-cols-1 md:grid-cols-2 gap-3">{periods.map((period, index) => <Card key={index} className="py-0"><CardContent className="p-5"><p className="font-headline text-[22px] text-[#001A2E]">{period.title}</p><div className="mt-3 space-y-2">{period.points?.map((point) => <div key={point} className="flex gap-2 text-[13px] leading-relaxed text-foreground/75"><span className="text-[#0CA4C3]">•</span><p>{point}</p></div>)}</div></CardContent></Card>)}</div>{!!report.beforeAfter?.differentiators?.length && <Card className="py-0 border-[#0CA4C3]/30"><CardContent className="p-5"><p className="text-[12px] font-semibold uppercase tracking-wide text-[#0394B2]">What changed</p><div className="mt-3 grid gap-2 md:grid-cols-2">{report.beforeAfter.differentiators.map((item) => <p key={item} className="text-[13px] leading-relaxed text-foreground/75">• {item}</p>)}</div></CardContent></Card>}</div>;
}

export function CustomReportGenerator({ clientSlug, clientName }: { clientSlug: string; clientName: string }) {
  const defaults = useMemo(defaultDates, []);
  const [mode, setMode] = useState<ReportMode>("comparison");
  const [dates, setDates] = useState(defaults);
  const [query, setQuery] = useState(EXAMPLE_QUERY);
  const [sources, setSources] = useState({ ga: true, clarity: true, seranking: true });
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
  const chartData = (ga?.daily || []).map((point) => ({ ...point, periodLabel: point.range === "pre" ? "Pre-launch" : point.range === "post" ? "Post-launch" : "Selected range" }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground mb-2"><span>{clientName}</span><span>/</span><span className="text-[#0394B2]">Report Generator</span></div>
        <h2 className="font-headline text-[32px] text-[#001A2E] tracking-tight">Custom Report Generator</h2>
        <p className="text-[15px] text-muted-foreground mt-1 max-w-3xl">Compare any two periods using the client’s connected analytics and search data, then generate a detailed report or a reusable evidence-filled prompt.</p>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-5">
          <div className="flex flex-wrap gap-2">
            {([['comparison', 'Compare two periods'], ['single', 'Single date range'], ['prompt-only', 'Prompt only']] as const).map(([value, label]) => <button key={value} onClick={() => { setMode(value); setResult(null); }} className={`rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors ${mode === value ? "border-[#001A2E] bg-[#001A2E] text-white" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
          </div>

          {mode === "comparison" && <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {(["pre", "post"] as const).map((period) => (
              <div key={period} className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#097388]/75 mb-3">{period === "pre" ? "Pre-launch period" : "Post-launch period"}</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[12px] text-muted-foreground">Start<input type="date" value={dates[`${period}Start`]} onChange={(event) => setDates((current) => ({ ...current, [`${period}Start`]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground" /></label>
                  <label className="text-[12px] text-muted-foreground">End<input type="date" value={dates[`${period}End`]} onChange={(event) => setDates((current) => ({ ...current, [`${period}End`]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground" /></label>
                </div>
              </div>
            ))}
          </div>}

          {mode === "single" && <div className="rounded-xl border border-border/70 bg-muted/20 p-4"><p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#097388]/75 mb-3">Analysis period</p><div className="grid grid-cols-2 gap-3 max-w-xl"><label className="text-[12px] text-muted-foreground">Start<input type="date" value={dates.singleStart} onChange={(event) => setDates((current) => ({ ...current, singleStart: event.target.value }))} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground" /></label><label className="text-[12px] text-muted-foreground">End<input type="date" value={dates.singleEnd} onChange={(event) => setDates((current) => ({ ...current, singleEnd: event.target.value }))} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground" /></label></div></div>}

          {mode === "prompt-only" && <div className="rounded-xl border border-[#0CA4C3]/20 bg-[#0CA4C3]/5 p-4 text-[13px] text-[#01384C]">No dates or analytics will be pulled. This creates a clean strategic prompt from your request.</div>}

          <div>
            <label className="text-[13px] font-medium text-foreground/80">What should the report answer?</label>
            <textarea value={query} onChange={(event) => setQuery(event.target.value)} rows={6} className="mt-2 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/25" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4">
            <div className={`flex flex-wrap gap-2 ${mode === "prompt-only" ? "invisible" : ""}`}>
              {([['ga', 'Google Analytics 4'], ['clarity', 'Microsoft Clarity'], ['seranking', 'SE Ranking']] as const).map(([key, label]) => (
                <label key={key} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-medium ${sources[key] ? "border-[#0CA4C3]/35 bg-[#0CA4C3]/10 text-[#01384C]" : "border-border text-muted-foreground"}`}><input type="checkbox" checked={sources[key]} onChange={(event) => setSources((current) => ({ ...current, [key]: event.target.checked }))} className="sr-only" />{label}</label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => run("prompt")} disabled={loading !== null} className="inline-flex items-center gap-2 rounded-lg border border-[#001A2E]/20 px-4 py-2 text-[13px] font-medium text-[#001A2E] hover:bg-[#001A2E]/5 disabled:opacity-50">{loading === "prompt" ? <Loader2 size={14} className="animate-spin" /> : <Clipboard size={14} />}Generate prompt</button>
              {mode !== "prompt-only" && <button onClick={() => run("report")} disabled={loading !== null} className="inline-flex items-center gap-2 rounded-lg bg-[#001A2E] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#01384C] disabled:opacity-50">{loading === "report" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Generate report</button>}
            </div>
          </div>
        </CardContent>
      </Card>

      {result?.error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">{result.error}</div>}

      {result && !result.error && (
        <div className="space-y-6">
          {ga?.summary && mode === "comparison" && <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><MetricComparison label="Sessions" pre={ga.summary.pre?.sessions} post={ga.summary.post?.sessions} /><MetricComparison label="Pageviews" pre={ga.summary.pre?.pageviews} post={ga.summary.post?.pageviews} /><MetricComparison label="Users" pre={ga.summary.pre?.users} post={ga.summary.post?.users} /></div>}
          {ga?.summary?.single && mode === "single" && <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><MetricSingle label="Sessions" value={ga.summary.single.sessions} /><MetricSingle label="Pageviews" value={ga.summary.single.pageviews} /><MetricSingle label="Users" value={ga.summary.single.users} /></div>}

          {chartData.length > 0 && <Card><CardContent className="pt-5"><div className="flex items-center gap-2 mb-4"><BarChart3 size={15} className="text-[#0CA4C3]" /><p className="font-headline text-[21px] text-[#001A2E]">GA4 traffic by day</p><PlainTooltip text="This shows how many visits happened each day. Hover to see the busiest pages." /></div><div className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="reportSessions" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0CA4C3" stopOpacity={0.3}/><stop offset="95%" stopColor="#0CA4C3" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#001A2E18"/><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28}/><YAxis tick={{ fontSize: 10 }} width={36}/><Tooltip content={<ReportChartTooltip />} />{mode === "comparison" && <ReferenceLine x={dates.postStart} stroke="#001A2E" strokeWidth={2} label={{ value: "Comparison starts", position: "insideTopRight", fill: "#001A2E", fontSize: 11 }} />}<Area type="monotone" dataKey="sessions" stroke="#0CA4C3" strokeWidth={2} fill="url(#reportSessions)"/></AreaChart></ResponsiveContainer></div></CardContent></Card>}

          {(se?.visibilityHistory?.length || 0) > 0 && <Card><CardContent className="pt-5"><div className="flex items-center gap-2 mb-4"><p className="font-headline text-[21px] text-[#001A2E]">SE Ranking visibility history</p><PlainTooltip text="Visibility shows how easy it is to find the site in search results. A higher line is better." /></div><div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={se!.visibilityHistory}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#001A2E18"/><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28}/><YAxis tick={{ fontSize: 10 }} width={40}/><Tooltip/>{mode === "comparison" && <ReferenceLine x={dates.postStart} stroke="#0CA4C3" strokeWidth={2} label={{ value: "Comparison starts", position: "insideTopRight", fill: "#001A2E", fontSize: 11 }} />}<Line type="monotone" dataKey="score" stroke="#001A2E" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></CardContent></Card>}

          {result.report && <div className="space-y-5"><div><p className="font-headline text-[27px] text-[#001A2E]">Generated report</p><p className="text-[13px] text-muted-foreground">The main findings are grouped into quick, readable cards.</p></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{result.report.sections?.map((section) => <ReportSectionCard key={section.key} section={section} />)}</div>{mode === "comparison" && <BeforeAfter report={result.report} />}{!!result.report.recommendations?.length && <div><p className="mb-3 font-headline text-[22px] text-[#001A2E]">Recommendations</p><div className="grid gap-3 md:grid-cols-2">{result.report.recommendations.map((item) => <Card key={item.title} className="py-0"><CardContent className="p-4"><p className="text-[14px] font-semibold text-[#001A2E]">{item.title}</p><p className="mt-2 text-[13px] text-foreground/75">{item.action}</p><p className="mt-2 text-[12px] text-muted-foreground">Why: {item.why}</p></CardContent></Card>)}</div></div>}<details className="group rounded-xl border border-border bg-white"><summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-[13px] font-medium text-[#001A2E]">Supporting context and data limits<ChevronDown size={15} className="transition-transform group-open:rotate-180" /></summary><div className="border-t border-border px-5 py-4 space-y-2">{[...(result.report.context || []), ...(result.limitations || [])].map((item) => <p key={item} className="text-[12px] leading-relaxed text-muted-foreground">• {item}</p>)}</div></details></div>}

          {result.prompt && <Card><CardContent className="pt-5"><div className="flex items-center justify-between gap-4 mb-3"><p className="font-headline text-[21px] text-[#001A2E]">Reusable prompt</p><button onClick={copyPrompt} className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground/70 hover:bg-muted/80">{copied ? <Check size={12}/> : <Clipboard size={12}/>} {copied ? "Copied" : "Copy"}</button></div><pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#001A2E] p-4 text-[11px] leading-relaxed text-white/75">{result.prompt}</pre></CardContent></Card>}
        </div>
      )}
    </div>
  );
}
