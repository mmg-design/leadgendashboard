"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from "recharts";

interface KeywordRow {
  id: string;
  keyword: string;
  position: number;
  delta: number | null;
}

interface SearchPerformanceData {
  totalKeywords: number;
  movedUp: number;
  movedDown: number;
  top5: KeywordRow[];
  currentVisibility: number | null;
  visibilityHistory: { date: string; score: number }[];
}

interface SearchPerformanceProps {
  data: SearchPerformanceData | null;
  loading: boolean;
  error: string | null;
  enabled: boolean;
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <Minus size={12} className="text-muted-foreground/30" />;
  if (delta > 0)
    return (
      <span className="flex items-center gap-0.5 text-emerald-600 text-[11px] font-semibold">
        <ArrowUp size={10} />+{delta}
      </span>
    );
  if (delta < 0)
    return (
      <span className="flex items-center gap-0.5 text-amber-600 text-[11px] font-semibold">
        <ArrowDown size={10} />{delta}
      </span>
    );
  return <Minus size={12} className="text-muted-foreground/30" />;
}

function PositionBadge({ position }: { position: number }) {
  const color =
    position <= 3
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : position <= 10
      ? "bg-[#0B4F6C]/8 text-[#0B4F6C] border-[#0B4F6C]/20"
      : position <= 30
      ? "bg-muted/60 text-foreground/70 border-border"
      : "bg-muted/30 text-muted-foreground border-border";
  return (
    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border tabular-nums ${color}`}>
      #{position}
    </span>
  );
}

export function SearchPerformance({ data, loading, error, enabled }: SearchPerformanceProps) {
  if (!enabled) {
    return (
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Search size={15} className="text-muted-foreground/60" />
            <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">
              Search Performance
            </CardTitle>
            <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground tracking-wide uppercase">
              Not configured
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted-foreground">
            Add an SE Ranking project ID in settings to enable keyword tracking.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Search size={15} className="text-muted-foreground/60" />
            <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">
              Search Performance
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 rounded-lg bg-muted/60" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Search size={15} className="text-muted-foreground/60" />
            <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">
              Search Performance
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-red-500">{error || "No data available"}</p>
        </CardContent>
      </Card>
    );
  }

  const allKeywords = data.top5;
  const unchanged = allKeywords.filter((k) => k.delta === 0 || k.delta === null).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Search size={15} className="text-muted-foreground/60" />
          <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">
            Search Performance
          </CardTitle>
          <span className="text-[11px] text-muted-foreground ml-auto">SE Ranking · 7-day movement</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Visibility score + sparkline — prominently at top */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-[#0B4F6C]/[0.04] border border-[#0B4F6C]/[0.08]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
              Domain Visibility
            </div>
            <div className="text-[32px] font-light text-[#0B4F6C] tabular-nums leading-none">
              {data.currentVisibility !== null ? data.currentVisibility.toFixed(1) : "—"}
              <span className="text-[16px] text-muted-foreground font-normal ml-1">%</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">30-day trend</div>
          </div>
          {data.visibilityHistory.length > 2 ? (
            <div className="flex-1 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.visibilityHistory}>
                  <XAxis dataKey="date" hide />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#0B4F6C"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid rgba(0,0,0,0.06)",
                      borderRadius: "6px",
                      fontSize: "11px",
                      padding: "4px 8px",
                    }}
                    formatter={(v) => [`${Number(v).toFixed(1)}%`, "Visibility"]}
                    labelFormatter={(label) => label}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-muted-foreground/40">
              Trend builds after 3+ data points
            </div>
          )}
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/30 px-3 py-2.5 text-center">
            <div className="text-[22px] font-light text-foreground tabular-nums">
              {data.totalKeywords}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Keywords tracked</div>
          </div>
          <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-center">
            <div className="flex items-center justify-center gap-1">
              <TrendingUp size={13} className="text-emerald-600" />
              <span className="text-[22px] font-light text-emerald-700 tabular-nums">{data.movedUp}</span>
            </div>
            <div className="text-[10px] text-emerald-600 mt-0.5">Moved up</div>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-center">
            <div className="flex items-center justify-center gap-1">
              <TrendingDown size={13} className="text-amber-600" />
              <span className="text-[22px] font-light text-amber-700 tabular-nums">{data.movedDown}</span>
            </div>
            <div className="text-[10px] text-amber-600 mt-0.5">Moved down</div>
          </div>
        </div>

        {/* Keyword table */}
        {allKeywords.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Top keywords by rank
              </div>
              {unchanged > 0 && (
                <span className="text-[10px] text-muted-foreground/60">{unchanged} unchanged this week</span>
              )}
            </div>
            {/* Column headers */}
            <div className="flex items-center gap-3 px-2 pb-1 border-b border-border/40 mb-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-5">#</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex-1">Keyword</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-12 text-center">Rank</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-12 text-right">7d change</span>
            </div>
            <div className="space-y-0.5">
              {allKeywords.map((kw, i) => (
                <div
                  key={kw.id}
                  className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
                >
                  <span className="text-[11px] font-medium text-muted-foreground/40 w-5 text-right shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-[12px] text-foreground/80 flex-1 truncate" title={kw.keyword}>
                    {kw.keyword}
                  </span>
                  <div className="w-12 flex justify-center shrink-0">
                    <PositionBadge position={kw.position} />
                  </div>
                  <div className="w-12 flex justify-end shrink-0">
                    <DeltaBadge delta={kw.delta} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-[12px] text-muted-foreground/60">
              No keywords ranked in top 100 yet.
            </p>
            <p className="text-[11px] text-muted-foreground/40 mt-1">
              Rankings typically appear within 1–3 days of project setup.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
