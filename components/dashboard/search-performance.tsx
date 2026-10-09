"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverPanel } from "@/components/ui/hover-panel";
import { Search, ArrowUp, ArrowDown, ChevronDown, ChevronUp, RefreshCw, Sparkles } from "lucide-react";
import type { RankedKeyword } from "@/lib/keyword-insights";
import { DeltaText, KeywordDetail, PositionPill } from "./keyword-detail";

interface SearchPerformanceData {
  totalKeywords: number;
  movedUp: number;
  movedDown: number;
  top5: RankedKeyword[];
  allKeywords?: RankedKeyword[];
  currentVisibility: number | null;
  visibilityHistory: { date: string; score: number }[];
  aiVisibilityScore: number | null;
  aiOverviewCount: number;
  top10Count: number;
  averagePosition: number | null;
  newRankingsThisMonth: number;
}

interface SearchPerformanceProps {
  data: SearchPerformanceData | null;
  loading: boolean;
  error: string | null;
  enabled: boolean;
  onRefresh?: () => void;
}

const VISIBLE_ROWS = 8;

function Header({ onRefresh, loading, badge }: { onRefresh?: () => void; loading?: boolean; badge?: React.ReactNode }) {
  return (
    <CardHeader>
      <div className="flex items-center gap-2">
        <Search size={16} className="text-[#097388]/75" />
        <CardTitle className="text-[22px] font-headline font-normal text-[#001A2E]">Search Performance</CardTitle>
        {badge}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh search performance data"
            className="ml-auto p-1.5 rounded-md text-[#097388]/55 hover:text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-30"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        )}
      </div>
    </CardHeader>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#001A2E]">{value}</div>
      <div className="mt-1.5 text-[13px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export function SearchPerformance({ data, loading, error, enabled, onRefresh }: SearchPerformanceProps) {
  const [showAll, setShowAll] = useState(false);
  const [showUnranked, setShowUnranked] = useState(false);

  if (!enabled) {
    return (
      <Card className="opacity-60">
        <Header
          badge={
            <span className="ml-auto text-[12px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground tracking-wide uppercase">
              Not configured
            </span>
          }
        />
        <CardContent>
          <p className="text-[15px] text-muted-foreground">Add an SE Ranking project ID in settings to enable keyword tracking.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading && !data) {
    return (
      <Card>
        <Header />
        <CardContent>
          <div className="space-y-3 animate-pulse">
            <div className="grid grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded-xl bg-muted/60" />)}
            </div>
            {[1, 2, 3].map((i) => <div key={i} className="h-9 rounded-lg bg-muted/60" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <Header onRefresh={onRefresh} loading={loading} />
        <CardContent>
          <p className="text-[15px] text-red-600">{error || "No data available"}</p>
        </CardContent>
      </Card>
    );
  }

  const keywords = data.allKeywords ?? data.top5;
  const ranked = keywords.filter((k) => k.position > 0);
  const unranked = keywords.filter((k) => k.position === 0);
  const list = showUnranked ? keywords : ranked;
  const rows = showAll ? list : list.slice(0, VISIBLE_ROWS);

  return (
    <Card>
      <Header
        onRefresh={onRefresh}
        loading={loading}
        badge={<span className="text-[13px] text-muted-foreground">via SE Ranking</span>}
      />
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
          <Metric label="Ranking" value={`${ranked.length}`} sub={`of ${data.totalKeywords} tracked keywords`} />
          <Metric label="On page 1" value={String(data.top10Count)} sub="Keywords in the top 10" />
          <Metric
            label="Avg position"
            value={data.averagePosition !== null ? String(data.averagePosition) : "—"}
            sub="Across ranking keywords"
          />
          <Metric
            label="AI Overviews"
            value={String(data.aiOverviewCount)}
            sub={data.aiVisibilityScore !== null ? `${data.aiVisibilityScore}% of tracked keywords` : "Google AI Overviews"}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground mr-1">Last 7 days</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
            <ArrowUp size={12} /> {data.movedUp} moved up
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
            <ArrowDown size={12} /> {data.movedDown} moved down
          </span>
          {data.newRankingsThisMonth > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#2a78d6]/[0.08] px-2.5 py-1 font-semibold text-[#1c5cab]">
              <Sparkles size={12} /> {data.newRankingsThisMonth} newly ranking this month
            </span>
          )}
        </div>

        {keywords.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Keywords · hover for details
              </span>
              {unranked.length > 0 && (
                <button
                  onClick={() => setShowUnranked((v) => !v)}
                  className="text-[13px] font-medium text-[#0394B2] hover:text-[#001A2E] transition-colors"
                >
                  {showUnranked ? "Hide" : "Show"} {unranked.length} not ranking yet
                </button>
              )}
            </div>

            <div className="grid grid-cols-[1fr_88px_64px_52px] items-center gap-3 px-2 pb-2 border-b border-border text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              <span>Keyword</span>
              <span className="text-right">Searches/mo</span>
              <span className="text-center">Rank</span>
              <span className="text-right">7d</span>
            </div>
            <div className="divide-y divide-border/60">
              {rows.map((kw) => (
                <HoverPanel key={kw.id} content={() => <KeywordDetail kw={kw} />}>
                  <div className={`grid grid-cols-[1fr_88px_64px_52px] items-center gap-3 px-2 py-2.5 cursor-default ${kw.position === 0 ? "opacity-55" : ""}`}>
                    <span className="min-w-0 flex items-center gap-2">
                      <span className="truncate text-[15px] text-foreground/90">{kw.keyword}</span>
                      {kw.type?.branded && (
                        <span className="shrink-0 rounded bg-[#001A2E]/[0.06] px-1.5 py-0.5 text-[11px] font-semibold text-[#001A2E]/70">Brand</span>
                      )}
                    </span>
                    <span className="text-right text-[14px] tabular-nums text-muted-foreground">
                      {kw.volume != null ? kw.volume.toLocaleString() : "—"}
                    </span>
                    <span className="flex justify-center"><PositionPill position={kw.position} /></span>
                    <span className="flex justify-end">
                      <DeltaText delta={kw.position === 0 ? null : kw.delta} />
                    </span>
                  </div>
                </HoverPanel>
              ))}
            </div>

            {list.length > VISIBLE_ROWS && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="mt-2 w-full flex items-center justify-center gap-1 py-2 text-[13px] font-medium text-muted-foreground hover:text-[#001A2E] rounded-lg hover:bg-muted/40 transition-colors"
              >
                {showAll ? <><ChevronUp size={13} /> Show fewer</> : <><ChevronDown size={13} /> Show all {list.length}</>}
              </button>
            )}
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-[15px] text-muted-foreground">No keywords tracked yet.</p>
            <p className="text-[13px] text-muted-foreground/80 mt-1">Rankings typically appear within 1-3 days of project setup.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
