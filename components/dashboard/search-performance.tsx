"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown, ChevronDown, ChevronUp, Bot, Star, BarChart2, Sparkles, RefreshCw } from "lucide-react";

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
  allKeywords?: KeywordRow[];
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
  if (position === 0)
    return (
      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border tabular-nums bg-muted/30 text-muted-foreground/40 border-border">
        —
      </span>
    );
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

function aiVisibilityColor(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 50) return "text-emerald-600";
  if (score >= 20) return "text-amber-600";
  return "text-red-500";
}

function MetricTile({
  icon,
  label,
  value,
  valueClass,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-muted/30 border border-border/50 px-3 py-3">
      <div className="flex items-center gap-1.5 text-muted-foreground/60">
        {icon}
        <span className="text-[9px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-[26px] font-light tabular-nums leading-none ${valueClass ?? "text-foreground"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground/50">{sub}</div>}
    </div>
  );
}

export function SearchPerformance({ data, loading, error, enabled, onRefresh }: SearchPerformanceProps) {
  const [expanded, setExpanded] = useState(false);
  const [keywordsOpen, setKeywordsOpen] = useState(false);

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
            <div className="grid grid-cols-2 gap-2">
              {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-muted/60" />)}
            </div>
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

  const keywords = data.allKeywords ?? data.top5;
  const ranked = keywords.filter((k) => k.position > 0);
  const unranked = keywords.filter((k) => k.position === 0);
  const unchanged = keywords.filter((k) => k.delta === 0).length;

  const aiScore = data.aiVisibilityScore;
  const aiLabel = aiScore === null ? "—" : `${aiScore}%`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Search size={15} className="text-muted-foreground/60" />
          <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">
            Search Performance
          </CardTitle>
          <span className="text-[11px] text-muted-foreground">SE Ranking</span>
          <button
            onClick={onRefresh}
            disabled={loading || !onRefresh}
            title="Refresh search performance data"
            className="ml-auto p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-30"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* 4 metric tiles */}
        <div className="grid grid-cols-2 gap-2">
          <MetricTile
            icon={<Bot size={11} />}
            label="AI Visibility"
            value={aiLabel}
            valueClass={aiVisibilityColor(aiScore)}
            sub={aiScore !== null ? `${data.aiOverviewCount} of ${data.totalKeywords} keywords` : "Google AI Overviews"}
          />
          <MetricTile
            icon={<Star size={11} />}
            label="Top 10 Keywords"
            value={String(data.top10Count)}
            valueClass="text-[#0B4F6C]"
            sub="Ranking in top 10"
          />
          <MetricTile
            icon={<BarChart2 size={11} />}
            label="Avg Position"
            value={data.averagePosition !== null ? String(data.averagePosition) : "—"}
            sub="Across ranked keywords"
          />
          <MetricTile
            icon={<Sparkles size={11} />}
            label="New This Month"
            value={String(data.newRankingsThisMonth)}
            valueClass={data.newRankingsThisMonth > 0 ? "text-emerald-600" : "text-foreground"}
            sub="Keywords newly ranked"
          />
        </div>

        {/* Summary row — keep as-is */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/30 px-3 py-2.5 text-center">
            <div className="text-[22px] font-light text-foreground tabular-nums">{data.totalKeywords}</div>
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

        {/* Keyword list — collapsed by default, toggle to reveal */}
        {keywords.length > 0 ? (
          <div>
            <button
              onClick={() => setKeywordsOpen((o) => !o)}
              className="w-full flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/30 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  All keywords ({keywords.length})
                </span>
                {unranked.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/40">{unranked.length} not yet ranked</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unchanged > 0 && keywordsOpen && (
                  <span className="text-[10px] text-muted-foreground/50">{unchanged} unchanged</span>
                )}
                {keywordsOpen
                  ? <ChevronUp size={13} className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                  : <ChevronDown size={13} className="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                }
              </div>
            </button>

            {keywordsOpen && (
              <>
                <div className="flex items-center gap-3 px-2 pb-1 border-b border-border/40 mb-1 mt-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-5">#</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex-1">Keyword</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-12 text-center">Rank</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-12 text-right">7d change</span>
                </div>

                <div
                  className={`overflow-y-auto transition-all duration-200 ${expanded ? "max-h-[500px]" : "max-h-[220px]"}`}
                  style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(0,0,0,0.1) transparent" }}
                >
                  <div className="space-y-0.5">
                    {keywords.map((kw, i) => (
                      <div
                        key={kw.id}
                        className={`flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/30 transition-colors ${kw.position === 0 ? "opacity-50" : ""}`}
                      >
                        <span className="text-[11px] font-medium text-muted-foreground/40 w-5 text-right shrink-0">{i + 1}</span>
                        <span className="text-[12px] text-foreground/80 flex-1 truncate" title={kw.keyword}>{kw.keyword}</span>
                        <div className="w-12 flex justify-center shrink-0">
                          <PositionBadge position={kw.position} />
                        </div>
                        <div className="w-12 flex justify-end shrink-0">
                          <DeltaBadge delta={kw.position === 0 ? null : kw.delta} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {keywords.length > 7 && (
                  <button
                    onClick={() => setExpanded((e) => !e)}
                    className="mt-1 w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground rounded-md hover:bg-muted/30 transition-colors"
                  >
                    {expanded ? <><ChevronUp size={11} /> Show less</> : <><ChevronDown size={11} /> Show all {keywords.length}</>}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-[12px] text-muted-foreground/60">No keywords tracked yet.</p>
            <p className="text-[11px] text-muted-foreground/40 mt-1">
              Rankings typically appear within 1–3 days of project setup.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
