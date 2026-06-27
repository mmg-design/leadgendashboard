"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

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
  if (delta === null) return <Minus size={12} className="text-muted-foreground/40" />;
  if (delta > 0)
    return (
      <span className="flex items-center gap-0.5 text-emerald-600 text-[11px] font-medium">
        <ArrowUp size={10} />
        {delta}
      </span>
    );
  if (delta < 0)
    return (
      <span className="flex items-center gap-0.5 text-amber-600 text-[11px] font-medium">
        <ArrowDown size={10} />
        {Math.abs(delta)}
      </span>
    );
  return <Minus size={12} className="text-muted-foreground/40" />;
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
            {[1, 2, 3].map((i) => (
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Search size={15} className="text-muted-foreground/60" />
          <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">
            Search Performance
          </CardTitle>
          <span className="text-[11px] text-muted-foreground ml-auto">SE Ranking · last 7 days</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/30 px-4 py-3 text-center">
            <div className="text-[22px] font-light text-foreground tabular-nums">
              {data.totalKeywords}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Keywords tracked</div>
          </div>
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <TrendingUp size={14} className="text-emerald-600" />
              <span className="text-[22px] font-light text-emerald-700 tabular-nums">
                {data.movedUp}
              </span>
            </div>
            <div className="text-[11px] text-emerald-600 mt-0.5">Moved up</div>
          </div>
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <TrendingDown size={14} className="text-amber-600" />
              <span className="text-[22px] font-light text-amber-700 tabular-nums">
                {data.movedDown}
              </span>
            </div>
            <div className="text-[11px] text-amber-600 mt-0.5">Moved down</div>
          </div>
        </div>

        {/* Top 5 keywords */}
        {data.top5.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Top keywords
            </div>
            <div className="space-y-1">
              {data.top5.map((kw, i) => (
                <div
                  key={kw.id}
                  className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors"
                >
                  <span className="text-[12px] font-medium text-muted-foreground/50 w-4 text-right shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-[13px] text-foreground/80 flex-1 truncate">{kw.keyword}</span>
                  <span className="text-[13px] font-medium text-[#0B4F6C] tabular-nums shrink-0">
                    #{kw.position}
                  </span>
                  <div className="w-8 flex justify-end shrink-0">
                    <DeltaBadge delta={kw.delta} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Visibility score + sparkline */}
        {data.currentVisibility !== null && (
          <div className="flex items-center gap-4 pt-1 border-t border-border/50">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Domain visibility
              </div>
              <div className="text-[26px] font-light text-[#0B4F6C] tabular-nums">
                {data.currentVisibility.toFixed(1)}
                <span className="text-[14px] text-muted-foreground font-normal ml-1">%</span>
              </div>
            </div>
            {data.visibilityHistory.length > 2 && (
              <div className="flex-1 h-14">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.visibilityHistory}>
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#0B4F6C"
                      strokeWidth={1.5}
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
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
