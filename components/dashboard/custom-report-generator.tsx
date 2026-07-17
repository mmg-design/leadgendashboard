"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Check, Clipboard, FileText, Loader2, Sparkles } from "lucide-react";

type DailyPoint = { range: "pre" | "post"; date: string; sessions: number; pageviews: number; engagedSessions: number };
type VisibilityPoint = { range: "pre" | "post" | "outside"; date: string; score: number };
type Result = {
  report?: string;
  prompt?: string;
  data?: {
    ga?: { summary?: { pre?: Record<string, number>; post?: Record<string, number>; changes?: Record<string, number | null> }; daily?: DailyPoint[] };
    seranking?: { summary?: { pre?: Record<string, number | null>; post?: Record<string, number | null> }; visibilityHistory?: VisibilityPoint[] };
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
  return { preStart: fmt(preStart), preEnd: fmt(preEnd), postStart: fmt(postStart), postEnd: fmt(postEnd) };
}

function MetricComparison({ label, pre, post, suffix = "" }: { label: string; pre?: number | null; post?: number | null; suffix?: string }) {
  const change = pre && post != null ? ((post - pre) / pre) * 100 : null;
  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-[0.1em] text-[#097388]/75 font-semibold">{label}</p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div><p className="text-[11px] text-muted-foreground">Pre</p><p className="font-headline text-[25px] text-[#001A2E]">{pre == null ? "—" : `${pre.toLocaleString()}${suffix}`}</p></div>
          <div className="text-right"><p className="text-[11px] text-muted-foreground">Post</p><p className="font-headline text-[25px] text-[#001A2E]">{post == null ? "—" : `${post.toLocaleString()}${suffix}`}</p></div>
        </div>
        <p className={`mt-2 text-[12px] font-medium ${change == null ? "text-muted-foreground" : change >= 0 ? "text-emerald-700" : "text-amber-700"}`}>{change == null ? "No comparable baseline" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</p>
      </CardContent>
    </Card>
  );
}

function ReportBody({ report }: { report: string }) {
  return (
    <div className="space-y-2 text-[14px] leading-7 text-foreground/80">
      {report.split("\n").map((raw, index) => {
        const line = raw.replace(/\*\*/g, "").trim();
        if (!line) return <div key={index} className="h-2" />;
        if (line.startsWith("### ")) return <h4 key={index} className="pt-3 text-[17px] font-semibold text-[#001A2E]">{line.slice(4)}</h4>;
        if (line.startsWith("## ")) return <h3 key={index} className="pt-4 font-headline text-[24px] text-[#001A2E]">{line.slice(3)}</h3>;
        if (line.startsWith("# ")) return <h2 key={index} className="font-headline text-[28px] text-[#001A2E]">{line.slice(2)}</h2>;
        if (/^[-*]\s/.test(line)) return <div key={index} className="flex gap-2 pl-2"><span className="text-[#0CA4C3]">•</span><p>{line.slice(2)}</p></div>;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

export function CustomReportGenerator({ clientSlug, clientName }: { clientSlug: string; clientName: string }) {
  const defaults = useMemo(defaultDates, []);
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
          clientSlug, query, output,
          pre: { start: dates.preStart, end: dates.preEnd },
          post: { start: dates.postStart, end: dates.postEnd },
          sources: Object.entries(sources).filter(([, enabled]) => enabled).map(([source]) => source),
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
  const chartData = (ga?.daily || []).map((point) => ({ ...point, periodLabel: point.range === "pre" ? "Pre-launch" : "Post-launch" }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground mb-2"><span>{clientName}</span><span>/</span><span className="text-[#0394B2]">Report Generator</span></div>
        <h2 className="font-headline text-[32px] text-[#001A2E] tracking-tight">Custom Report Generator</h2>
        <p className="text-[15px] text-muted-foreground mt-1 max-w-3xl">Compare any two periods using the client’s connected analytics and search data, then generate a detailed report or a reusable evidence-filled prompt.</p>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {(["pre", "post"] as const).map((period) => (
              <div key={period} className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#097388]/75 mb-3">{period === "pre" ? "Pre-launch period" : "Post-launch period"}</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[12px] text-muted-foreground">Start<input type="date" value={dates[`${period}Start`]} onChange={(event) => setDates((current) => ({ ...current, [`${period}Start`]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground" /></label>
                  <label className="text-[12px] text-muted-foreground">End<input type="date" value={dates[`${period}End`]} onChange={(event) => setDates((current) => ({ ...current, [`${period}End`]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground" /></label>
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="text-[13px] font-medium text-foreground/80">What should the report answer?</label>
            <textarea value={query} onChange={(event) => setQuery(event.target.value)} rows={6} className="mt-2 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/25" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4">
            <div className="flex flex-wrap gap-2">
              {([['ga', 'Google Analytics 4'], ['clarity', 'Microsoft Clarity'], ['seranking', 'SE Ranking']] as const).map(([key, label]) => (
                <label key={key} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-medium ${sources[key] ? "border-[#0CA4C3]/35 bg-[#0CA4C3]/10 text-[#01384C]" : "border-border text-muted-foreground"}`}><input type="checkbox" checked={sources[key]} onChange={(event) => setSources((current) => ({ ...current, [key]: event.target.checked }))} className="sr-only" />{label}</label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => run("prompt")} disabled={loading !== null} className="inline-flex items-center gap-2 rounded-lg border border-[#001A2E]/20 px-4 py-2 text-[13px] font-medium text-[#001A2E] hover:bg-[#001A2E]/5 disabled:opacity-50">{loading === "prompt" ? <Loader2 size={14} className="animate-spin" /> : <Clipboard size={14} />}Generate prompt</button>
              <button onClick={() => run("report")} disabled={loading !== null} className="inline-flex items-center gap-2 rounded-lg bg-[#001A2E] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#01384C] disabled:opacity-50">{loading === "report" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Generate report</button>
            </div>
          </div>
        </CardContent>
      </Card>

      {result?.error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">{result.error}</div>}

      {result && !result.error && (
        <div className="space-y-6">
          {result.limitations && result.limitations.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-[13px] font-semibold text-amber-900">Data notes</p>{result.limitations.map((item) => <p key={item} className="mt-1 text-[12px] leading-relaxed text-amber-800">{item}</p>)}</div>}

          {ga?.summary && <div className="grid grid-cols-2 xl:grid-cols-4 gap-3"><MetricComparison label="Sessions" pre={ga.summary.pre?.sessions} post={ga.summary.post?.sessions} /><MetricComparison label="Pageviews" pre={ga.summary.pre?.pageviews} post={ga.summary.post?.pageviews} /><MetricComparison label="Users" pre={ga.summary.pre?.users} post={ga.summary.post?.users} /><MetricComparison label="Engagement rate" pre={(ga.summary.pre?.engagementRate || 0) * 100} post={(ga.summary.post?.engagementRate || 0) * 100} suffix="%" /></div>}

          {chartData.length > 0 && <Card><CardContent className="pt-5"><div className="flex items-center gap-2 mb-4"><BarChart3 size={15} className="text-[#0CA4C3]" /><p className="font-headline text-[21px] text-[#001A2E]">GA4 traffic by day</p></div><div className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="reportSessions" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0CA4C3" stopOpacity={0.3}/><stop offset="95%" stopColor="#0CA4C3" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#001A2E18"/><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28}/><YAxis tick={{ fontSize: 10 }} width={36}/><Tooltip/><Area type="monotone" dataKey="sessions" stroke="#0CA4C3" strokeWidth={2} fill="url(#reportSessions)"/></AreaChart></ResponsiveContainer></div></CardContent></Card>}

          {(se?.visibilityHistory?.length || 0) > 0 && <Card><CardContent className="pt-5"><p className="font-headline text-[21px] text-[#001A2E] mb-4">SE Ranking visibility history</p><div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={se!.visibilityHistory}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#001A2E18"/><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28}/><YAxis tick={{ fontSize: 10 }} width={40}/><Tooltip/><Line type="monotone" dataKey="score" stroke="#001A2E" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></CardContent></Card>}

          {result.report && <Card><CardContent className="pt-5"><div className="flex items-center gap-2 mb-4"><FileText size={15} className="text-[#0CA4C3]"/><p className="font-headline text-[23px] text-[#001A2E]">Generated report</p></div><ReportBody report={result.report} /></CardContent></Card>}

          {result.prompt && <Card><CardContent className="pt-5"><div className="flex items-center justify-between gap-4 mb-3"><p className="font-headline text-[21px] text-[#001A2E]">Reusable prompt</p><button onClick={copyPrompt} className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground/70 hover:bg-muted/80">{copied ? <Check size={12}/> : <Clipboard size={12}/>} {copied ? "Copied" : "Copy"}</button></div><pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#001A2E] p-4 text-[11px] leading-relaxed text-white/75">{result.prompt}</pre></CardContent></Card>}
        </div>
      )}
    </div>
  );
}
