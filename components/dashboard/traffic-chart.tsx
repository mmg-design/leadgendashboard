"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { groupSources, lighten, OTHER_COLOR, sourceMeta } from "@/lib/source-colors";

interface DailyPoint {
  date: string;
  sessions: number;
  pageviews: number;
  topPages?: { page: string; views: number }[];
}

interface DailySource {
  date: string;
  source: string;
  sessions: number;
}

interface Series {
  key: string;
  label: string;
  color: string;
  total: number;
}

interface TrafficChartProps {
  data: DailyPoint[];
  dailySources?: DailySource[];
  title?: string;
}

// Five named sources plus "Other" keeps the stack readable; more bands than
// that turns into a striped blur nobody can follow.
const MAX_SERIES = 5;

// GA dates are calendar days; parse as local midnight so "Oct 3" doesn't
// render as "Oct 2" for anyone west of UTC.
function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Row = { date: string; label: string; total: number; topPages?: DailyPoint["topPages"] } & Record<string, number | string | unknown>;

function buildSeries(data: DailyPoint[], dailySources: DailySource[]) {
  const grouped = groupSources(dailySources);
  const top = grouped.slice(0, MAX_SERIES);
  const topKeys = new Set(top.map((g) => g.key));
  const otherTotal = grouped.slice(MAX_SERIES).reduce((sum, g) => sum + g.sessions, 0);

  const series: Series[] = top.map((g) => ({ key: g.key, label: g.label, color: g.color, total: g.sessions }));
  if (otherTotal > 0) series.push({ key: "other", label: "Other", color: OTHER_COLOR, total: otherTotal });

  const rows: Row[] = data.map((d) => {
    const row: Row = { date: d.date, label: shortDate(d.date), total: 0, topPages: d.topPages };
    for (const s of series) row[s.key] = 0;
    return row;
  });
  const byDate = new Map(rows.map((r) => [r.date, r]));
  for (const ds of dailySources) {
    const row = byDate.get(ds.date);
    if (!row) continue;
    const key = sourceMeta(ds.source).key;
    const target = topKeys.has(key) ? key : "other";
    row[target] = (row[target] as number) + ds.sessions;
    row.total += ds.sessions;
  }
  return { series, rows };
}

function ChartTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
  series: Series[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const lines = series.filter((s) => (row[s.key] as number) > 0);

  return (
    <div className="min-w-[200px] rounded-xl border border-border bg-white px-3.5 py-3 text-[13px] shadow-[0_8px_24px_rgba(0,26,46,0.12)]">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <span className="font-semibold text-[#001A2E]">{row.label}</span>
        <span className="text-muted-foreground tabular-nums">{row.total.toLocaleString()} sessions</span>
      </div>
      <div className="space-y-1">
        {/* Top of the stack first, matching what's under the cursor */}
        {[...lines].reverse().map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="size-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-foreground/80 flex-1">{s.label}</span>
            <span className="font-medium tabular-nums text-[#001A2E]">{(row[s.key] as number).toLocaleString()}</span>
          </div>
        ))}
      </div>
      {row.topPages && row.topPages.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-border">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Top pages</p>
          {row.topPages.map((p) => (
            <p key={p.page} className="text-foreground/75 truncate">
              {p.page} <span className="text-muted-foreground">· {p.views.toLocaleString()}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrafficChart({ data, dailySources, title = "Traffic Overview" }: TrafficChartProps) {
  const { series, rows } = useMemo(
    () => (dailySources?.length ? buildSeries(data, dailySources) : { series: [], rows: [] }),
    [data, dailySources]
  );
  const bySource = series.length > 0;

  // Fallback for cached payloads without the source split: one sessions line.
  const fallbackRows = useMemo(
    () => data.map((d) => ({ ...d, label: shortDate(d.date), total: d.sessions })),
    [data]
  );

  return (
    <Card className="col-span-full">
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-[#097388]/75" />
          <CardTitle className="text-[22px] font-headline font-normal text-[#001A2E]">{title}</CardTitle>
        </div>
        <p className="text-[14px] text-muted-foreground">
          {bySource ? "Sessions per day, split by where visitors came from." : "Sessions per day."}
        </p>
      </CardHeader>
      <CardContent>
        {bySource && (
          <div className="flex flex-wrap gap-x-5 gap-y-2 mb-5">
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-2 text-[14px] text-foreground/80">
                <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                {s.label}
                <span className="font-semibold tabular-nums text-[#001A2E]">{s.total.toLocaleString()}</span>
              </span>
            ))}
          </div>
        )}
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={bySource ? rows : fallbackRows} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <defs>
                {/* Same treatment as the Lead Funnel: each source runs from a light tint
                    of its color at the top to the full color at the bottom. */}
                {series.map((s, i) => (
                  <linearGradient key={s.key} id={`source-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lighten(s.color)} />
                    <stop offset="100%" stopColor={s.color} />
                  </linearGradient>
                ))}
                <linearGradient id="sessions-fallback" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2a78d6" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#2a78d6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(0,26,46,0.06)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "#365f6d", fontSize: 12 }}
                axisLine={{ stroke: "rgba(0,26,46,0.1)" }}
                tickLine={false}
                minTickGap={24}
                dy={6}
              />
              <YAxis
                tick={{ fill: "#365f6d", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={44}
              />
              <Tooltip
                content={<ChartTooltip series={series} />}
                cursor={{ stroke: "rgba(0,26,46,0.25)", strokeWidth: 1 }}
                wrapperStyle={{ outline: "none" }}
              />
              {bySource ? (
                series.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stackId="sources"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    fill={`url(#source-grad-${series.indexOf(s)})`}
                    fillOpacity={0.95}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                ))
              ) : (
                <Area
                  type="monotone"
                  dataKey="sessions"
                  stroke="#2a78d6"
                  strokeWidth={2}
                  fill="url(#sessions-fallback)"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
