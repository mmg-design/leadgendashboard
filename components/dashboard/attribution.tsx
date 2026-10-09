"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { GoalConfig } from "@/lib/clients";
import { EventWizardModal, TYPE_ICONS, type WizardValues } from "@/components/dashboard/event-wizard-modal";
import {
  Search,
  Eye,
  Loader2,
  Check,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  X,
  Video,
  ArrowDownRight,
} from "lucide-react";

interface ConversionResult {
  id: string;
  page: string;
  label?: string;
  count: number;
  previousCount?: number;
  change: number | null;
  sources?: { source: string; count: number }[];
}

interface AttributionGAData {
  comparison?: { label?: string };
  summary: {
    sessions: number;
    previousSessions?: number;
    sessionsChange?: number | null;
    engagementRate?: string;
    engagedSessions?: number;
    conversions: ConversionResult[];
  };
}

interface Suggestion {
  count?: number;
  views?: number;
  suggestedLabel: string;
}
interface EventSuggestion extends Suggestion {
  name: string;
  count: number;
}
interface PageSuggestion extends Suggestion {
  path: string;
  views: number;
}
interface DiscoverResult {
  eventSuggestions: EventSuggestion[];
  pageSuggestions: PageSuggestion[];
}

interface AttributionProps {
  clientSlug: string;
  goals: GoalConfig[];
  ga: AttributionGAData | null;
  loading?: boolean;
  range: string;
  posthog?: { enabled: boolean; projectId: string; host?: string };
  onGoalsSaved: () => void;
  onRefresh: () => void;
}

// PostHog is an optional, unrelated integration - GA4 stays the source of truth for
// every count on this page. This only builds a link to that project's session replay
// list; it never fires events, reads PostHog data, or touches the tracking snippet.
function postHogRecordingsUrl(posthog?: { enabled: boolean; projectId: string; host?: string }): string | null {
  if (!posthog?.enabled || !posthog.projectId) return null;
  const host = (posthog.host || "https://us.posthog.com").replace(/\/+$/, "");
  return `${host}/project/${posthog.projectId}/replay`;
}

// One color family per funnel stage, shared by the funnel chart, the rail dots,
// and the stage cards so the two read as one picture: yellow for everyone who
// arrived, orange for the ones who engaged, green for the ones who converted.
interface StageColor {
  from: string; // gradient top
  to: string; // gradient bottom
  solid: string; // rail dot, bar end, icon
  soft: string; // icon chip background
}

const VISITOR_COLOR: StageColor = { from: "#FFD76E", to: "#F2AE14", solid: "#E5A000", soft: "#FFF4D6" };
const WARM_COLOR: StageColor = { from: "#FFAE7A", to: "#EB6834", solid: "#E2602C", soft: "#FFEADF" };
// Each conversion goal gets a step lighter green so several goals stay distinguishable.
const CONVERTED_COLORS: StageColor[] = [
  { from: "#52D69B", to: "#159A5D", solid: "#159A5D", soft: "#E0F6EA" },
  { from: "#7CE0B2", to: "#2BAE70", solid: "#23A266", soft: "#E3F7ED" },
  { from: "#A3EACA", to: "#47C287", solid: "#3AB57A", soft: "#E8F9F0" },
];
const convertedColor = (i: number) => CONVERTED_COLORS[Math.min(i, CONVERTED_COLORS.length - 1)];

function parsePercent(value?: string): number {
  if (!value) return 0;
  const n = parseFloat(value.replace("%", ""));
  return isNaN(n) ? 0 : n;
}

function foundSiteInsight(sessionsChange: number | null | undefined, visited: number, previousSessions?: number, comparisonLabel = "previous period") {
  const sessions = visited.toLocaleString();
  if (sessionsChange === null || sessionsChange === undefined) {
    return {
      insight: `${sessions} sessions this period - not enough history yet to compare against the previous period.`,
      action: "Check back next period to see the trend.",
    };
  }
  if (sessionsChange <= -10) {
    return {
      insight: `Traffic dropped ${Math.abs(sessionsChange)}% versus the ${comparisonLabel}${previousSessions !== undefined ? ` (${previousSessions.toLocaleString()} → ${sessions})` : ""}.`,
      action: "Check recent search rankings and any paused campaigns for what changed.",
    };
  }
  if (sessionsChange >= 10) {
    return {
      insight: `Traffic grew ${sessionsChange}% versus the ${comparisonLabel}${previousSessions !== undefined ? ` (${previousSessions.toLocaleString()} → ${sessions})` : ""}.`,
      action: "Find out what's driving the increase and double down on it.",
    };
  }
  return {
    insight: `Traffic held roughly steady versus the ${comparisonLabel}${previousSessions !== undefined ? ` (${previousSessions.toLocaleString()} → ${sessions})` : ""}.`,
    action: "Traffic is stable - focus effort on the steps below instead.",
  };
}

function stuckAroundInsight(engagementPct: number, engagedSessions: number, visited: number) {
  const pct = Math.round(engagementPct);
  const counts = `${engagedSessions.toLocaleString()} of ${visited.toLocaleString()}`;
  const insight = `${pct}% engaged (${counts} sessions).`;
  if (engagementPct >= 60) {
    return {
      insight,
      action: "See what's resonating in Top Pages on the Overview tab and lean into it.",
    };
  }
  if (engagementPct >= 40) {
    return {
      insight,
      action: "Check scroll depth and rage clicks below for where people lose interest.",
    };
  }
  return {
    insight,
    action: "The message above the fold likely isn't landing - revisit the headline and first section.",
  };
}

function tookActionInsight(converted: number, change: number | null, pctOfEngaged: number) {
  const count = converted.toLocaleString();
  if (converted === 0) {
    return {
      insight: "No conversions recorded yet this period.",
      action: "Double-check the tracked page or event is still firing correctly.",
    };
  }
  if (change === null) {
    return {
      insight: `${count} conversions so far (${pctOfEngaged}% of engaged sessions) - not enough history yet to compare against the previous period.`,
      action: "Check back next period to see whether this is trending up or down.",
    };
  }
  if (change < 0) {
    return {
      insight: `${count} conversions, down ${Math.abs(change)}% compared to the previous period (${pctOfEngaged}% of engaged sessions).`,
      action: "Check whether traffic to the money pages dropped, or the conversion step broke.",
    };
  }
  return {
    insight: `${count} conversions, up ${change}% compared to the previous period (${pctOfEngaged}% of engaged sessions).`,
    action: "See which traffic sources are driving these and invest more there.",
  };
}

const KNOWN_SOURCE_NAMES: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  yahoo: "Yahoo",
  duckduckgo: "DuckDuckGo",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  twitter: "Twitter/X",
  "x.com": "Twitter/X",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  reddit: "Reddit",
};

function prettySourceName(source: string): string {
  const key = source.toLowerCase().trim();
  return KNOWN_SOURCE_NAMES[key] || source;
}

// Translates GA4's raw "source / medium" pair (e.g. "exactmedicare.com / referral",
// "(direct) / (none)") into a plain-English sentence describing how the visitor
// actually arrived - this is GA4 attribution data, not anything from Clarity.
function describeJourney(sourceMedium: string): string {
  const [rawSource, rawMedium] = sourceMedium.split(" / ").map((s) => s.trim());
  const source = rawSource || "an unknown source";
  const medium = (rawMedium || "").toLowerCase();
  const prettySource = prettySourceName(source);

  if (source === "(direct)" || medium === "(none)") {
    return "Went straight to the site - typed the URL directly or used a bookmark";
  }
  if (medium.includes("organic")) {
    return `Found the site through a ${prettySource} search`;
  }
  if (medium.includes("cpc") || medium.includes("ppc") || medium === "paid") {
    return `Clicked a paid ad on ${prettySource}`;
  }
  if (medium.includes("social")) {
    return `Came from a social post on ${prettySource}`;
  }
  if (medium.includes("email")) {
    return "Clicked a link in an email";
  }
  if (medium === "referral") {
    return `Followed a link from ${prettySource}`;
  }
  if (medium === "(not set)" || !medium) {
    return `Arrived via ${prettySource}`;
  }
  return `Arrived via ${prettySource} (${rawMedium})`;
}

function RailStep({ color, isFirst, isLast }: { color: string; isFirst?: boolean; isLast?: boolean }) {
  return (
    <div className="w-5 shrink-0 flex flex-col items-center">
      <div className={`w-0.5 flex-1 ${isFirst ? "bg-transparent" : "bg-border"}`} />
      <div className="w-3.5 h-3.5 rounded-full shrink-0 ring-4 ring-background" style={{ backgroundColor: color }} />
      <div className={`w-0.5 flex-1 ${isLast ? "bg-transparent" : "bg-border"}`} />
    </div>
  );
}

function StageBar({ color, widthPct, thin }: { color: StageColor; widthPct: number; thin?: boolean }) {
  return (
    <div className={`${thin ? "h-2" : "h-2.5"} rounded-full bg-[#001A2E]/[0.05] overflow-hidden`}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, ${color.from}, ${color.to})` }}
      />
    </div>
  );
}

function IconChip({ color, children, small }: { color: StageColor; children: React.ReactNode; small?: boolean }) {
  return (
    <div
      className={`${small ? "size-7 rounded-lg" : "size-9 rounded-xl"} shrink-0 flex items-center justify-center`}
      style={{ background: color.soft, color: color.solid }}
    >
      {children}
    </div>
  );
}

const iconButton =
  "p-1.5 rounded-md text-muted-foreground hover:text-[#001A2E] hover:bg-[#001A2E]/[0.05] transition-colors disabled:opacity-30";

function StageCard({
  icon,
  title,
  value,
  note,
  source,
  dropOff,
  insight,
  widthPct,
  color,
  onRefresh,
  refreshing,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  note: string;
  source: string;
  dropOff?: number;
  insight: string;
  widthPct: number;
  color: StageColor;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <IconChip color={color}>{icon}</IconChip>
            <div className="min-w-0">
              <div className="font-headline text-[22px] font-normal leading-tight tracking-[-0.02em] text-[#001A2E]">{title}</div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{source}</div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#001A2E]">
              {value.toLocaleString()}
            </span>
            <button onClick={onRefresh} disabled={refreshing} title={`Refresh ${title.toLowerCase()}`} className={iconButton}>
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div>
          <StageBar color={color} widthPct={widthPct} />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-[14px] text-muted-foreground">{note}</p>
            {dropOff !== undefined && dropOff > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FFEADF] px-2.5 py-0.5 text-[13px] font-semibold text-[#B4471B]">
                <ArrowDownRight size={12} />
                {dropOff.toLocaleString()} left before this step
              </span>
            )}
          </div>
        </div>

        <p className="text-[14px] leading-relaxed text-foreground/80 pt-3.5 border-t border-border/70">{insight}</p>
      </CardContent>
    </Card>
  );
}

function MiniGoalCard({
  icon,
  title,
  count,
  widthPct,
  caption,
  color,
  onRefresh,
  refreshing,
  onEdit,
  isPendingDelete,
  deletingSelf,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  postHogUrl,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  widthPct: number;
  caption: string;
  color: StageColor;
  onRefresh: () => void;
  refreshing: boolean;
  onEdit: () => void;
  isPendingDelete: boolean;
  deletingSelf: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  postHogUrl?: string | null;
}) {
  return (
    <Card className="py-5">
      <CardContent className="px-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <IconChip color={color} small>{icon}</IconChip>
            <span className="pt-1 text-[13px] font-semibold leading-snug text-foreground/85 line-clamp-2" title={title}>
              {title}
            </span>
          </div>
          <div className="flex items-center shrink-0 -mr-1.5">
            {isPendingDelete ? (
              <>
                <button onClick={onConfirmDelete} disabled={deletingSelf} title="Confirm delete" className="p-1.5 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                  {deletingSelf ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </button>
                <button onClick={onCancelDelete} title="Cancel" className={iconButton}>
                  <X size={13} />
                </button>
              </>
            ) : (
              <>
                {postHogUrl && (
                  <a href={postHogUrl} target="_blank" rel="noopener noreferrer" title="View session recordings in PostHog" className={iconButton}>
                    <Video size={13} />
                  </a>
                )}
                <button onClick={onRefresh} disabled={refreshing} title="Refresh" className={iconButton}>
                  <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
                </button>
                <button onClick={onEdit} title="Edit" className={iconButton}>
                  <Pencil size={13} />
                </button>
                <button onClick={onRequestDelete} title="Delete" className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors">
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#001A2E]">
            {count.toLocaleString()}
          </span>
          <span className="text-[15px] font-medium text-muted-foreground">{count === 1 ? "lead" : "leads"}</span>
        </div>

        <StageBar color={color} widthPct={widthPct} thin />

        <p className="text-[13px] text-muted-foreground leading-snug">{caption}</p>
      </CardContent>
    </Card>
  );
}

interface FunnelStageDatum {
  key: string;
  label: string;
  count: number;
  rateText: string | null; // e.g. "36% of visitors"
  insight: string;
  color: StageColor;
  sources?: { source: string; count: number }[];
}

const SEGMENT_H = 84;
const SEGMENT_GAP = 4;
const SHAPE_W = 150; // funnel shape; labels sit to its right so narrow stages stay readable
const VIEW_W = 320;
const MIN_WIDTH_PCT = 16;

// A smooth S-curve taper between one stage's width and the next, instead of a
// hard-angled trapezoid - reads as a flowing funnel rather than a stack of wedges.
function curvySegmentPath(topPct: number, bottomPct: number, yTop: number): string {
  const yBot = yTop + SEGMENT_H;
  const yMid = yTop + SEGMENT_H / 2;
  const topW = (topPct / 100) * SHAPE_W;
  const botW = (bottomPct / 100) * SHAPE_W;
  const topL = (SHAPE_W - topW) / 2;
  const topR = SHAPE_W - topL;
  const botL = (SHAPE_W - botW) / 2;
  const botR = SHAPE_W - botL;
  return `M ${topL},${yTop} C ${topL},${yMid} ${botL},${yMid} ${botL},${yBot} L ${botR},${yBot} C ${botR},${yMid} ${topR},${yMid} ${topR},${yTop} Z`;
}

function pct(part: number, whole: number) {
  if (whole <= 0) return "0%";
  const v = (part / whole) * 100;
  return `${v < 1 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;
}

function FunnelPanel({
  visited,
  engagedSessions,
  foundSiteInsightText,
  stuckAroundInsightText,
  conversions,
  maxCount,
  range,
}: {
  visited: number;
  engagedSessions: number;
  foundSiteInsightText: string;
  stuckAroundInsightText: string;
  conversions: ConversionResult[];
  maxCount: number;
  range: string;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [hoveredStage, setHoveredStage] = useState<FunnelStageDatum | null>(null);

  const stages: FunnelStageDatum[] = [
    { key: "visitors", label: "Visitors", count: visited, rateText: null, insight: foundSiteInsightText, color: VISITOR_COLOR },
    {
      key: "warm",
      label: "Warm",
      count: engagedSessions,
      rateText: `${pct(engagedSessions, visited)} of visitors`,
      insight: stuckAroundInsightText,
      color: WARM_COLOR,
    },
    ...conversions.map((c, i) => ({
      key: `goal-${c.id}`,
      label: c.label || c.page,
      count: c.count,
      rateText: `${pct(c.count, engagedSessions)} of warm`,
      insight: tookActionInsight(
        c.count,
        c.change,
        engagedSessions > 0 ? Math.round((c.count / engagedSessions) * 100) : 0
      ).insight,
      color: convertedColor(i),
      sources: c.sources,
    })),
  ];

  // Proportional widths, with a floor so a small stage is still a visible shape.
  function widthPctFor(count: number): number {
    return Math.max((count / maxCount) * 100, MIN_WIDTH_PCT);
  }

  function handleEnter(e: React.MouseEvent<SVGGElement>, stage: FunnelStageDatum) {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.left - 16 });
    setHoveredStage(stage);
    setTooltipVisible(true);
  }

  const svgHeight = stages.length * (SEGMENT_H + SEGMENT_GAP) - SEGMENT_GAP;
  const totalLeads = conversions.reduce((sum, c) => sum + c.count, 0);

  return (
    <>
      <Card className="xl:sticky xl:top-8">
        <CardContent>
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-headline text-[22px] font-normal text-[#001A2E]">The funnel</p>
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Last {range}</span>
          </div>
          <p className="text-[13px] text-muted-foreground mb-5">Hover a stage for context</p>

          <svg viewBox={`0 0 ${VIEW_W} ${svgHeight}`} width="100%" className="overflow-visible" role="img" aria-label="Lead funnel">
            <defs>
              {stages.map((stage) => (
                <linearGradient key={stage.key} id={`funnel-${stage.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stage.color.from} />
                  <stop offset="100%" stopColor={stage.color.to} />
                </linearGradient>
              ))}
              {/* Soft highlight down the left side so the shape reads as rounded, not flat */}
              <linearGradient id="funnel-sheen" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
                <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <filter id="funnel-shadow" x="-20%" y="-10%" width="140%" height="130%">
                <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#001A2E" floodOpacity="0.12" />
              </filter>
            </defs>

            {stages.map((stage, i) => {
              const widthPct = widthPctFor(stage.count);
              const prevWidthPct = i === 0 ? 100 : widthPctFor(stages[i - 1].count);
              const yTop = i * (SEGMENT_H + SEGMENT_GAP);
              const yMid = yTop + SEGMENT_H / 2;
              const path = curvySegmentPath(prevWidthPct, widthPct, yTop);
              const label = stage.label.length > 22 ? `${stage.label.slice(0, 20)}…` : stage.label;
              const labelX = SHAPE_W + 22;
              return (
                <g
                  key={stage.key}
                  onMouseEnter={(e) => handleEnter(e, stage)}
                  onMouseLeave={() => setTooltipVisible(false)}
                  className="cursor-default"
                >
                  <path d={path} fill={`url(#funnel-${stage.key})`} filter="url(#funnel-shadow)" />
                  <path d={path} fill="url(#funnel-sheen)" className="transition-opacity duration-150" />
                  <rect x={labelX - 10} y={yMid - 22} width="3" height="44" rx="1.5" fill={stage.color.solid} />
                  <text x={labelX} y={yMid - 4} fill="#001A2E" fontSize="24" fontWeight="600" letterSpacing="-0.02em">
                    {stage.count.toLocaleString()}
                  </text>
                  <text x={labelX} y={yMid + 15} fill="#001A2E" fillOpacity="0.8" fontSize="13" fontWeight="500">
                    {label}
                  </text>
                  {stage.rateText && (
                    <text x={labelX} y={yMid + 31} fill="#365f6d" fontSize="12">
                      {stage.rateText}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {conversions.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border/70 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-muted-foreground">Visitor-to-lead rate</span>
              <span className="text-[20px] font-semibold tabular-nums text-[#001A2E]">{pct(totalLeads, visited)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div
        className={`fixed z-[60] w-80 p-4 rounded-2xl bg-white border border-border shadow-[0_12px_40px_rgba(0,26,46,0.16),0_2px_6px_rgba(0,26,46,0.06)] pointer-events-none transition-all duration-200 ease-out ${
          tooltipVisible ? "opacity-100" : "opacity-0"
        }`}
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          transform: `translate(-100%, -50%) scale(${tooltipVisible ? 1 : 0.96})`,
        }}
      >
        {hoveredStage && (
          <>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="size-2.5 rounded-full" style={{ background: hoveredStage.color.solid }} />
              <p className="text-[15px] font-semibold text-[#001A2E]">
                {hoveredStage.label} · {hoveredStage.count.toLocaleString()}
              </p>
            </div>
            <p className="text-[14px] text-foreground/75 leading-relaxed">{hoveredStage.insight}</p>
            {hoveredStage.sources && hoveredStage.sources.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1.5">
                  How they got here
                </p>
                <div className="space-y-1.5">
                  {hoveredStage.sources.map((s) => (
                    <p key={s.source} className="text-[13px] text-foreground/80 leading-snug">
                      {describeJourney(s.source)}
                      <span className="text-muted-foreground"> · {s.count} {s.count === 1 ? "person" : "people"}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function Attribution({
  clientSlug,
  goals,
  ga,
  loading,
  range,
  posthog,
  onGoalsSaved,
  onRefresh,
}: AttributionProps) {
  const postHogUrl = postHogRecordingsUrl(posthog);
  const [wizardMode, setWizardMode] = useState<"closed" | "adding" | string>("closed"); // string = editing goal id
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DiscoverResult | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    if (wizardMode === "closed" || suggestions || suggestionsLoading) return;
    setSuggestionsLoading(true);
    fetch(`/api/ga/discover?client=${clientSlug}`)
      .then((r) => r.json())
      .then((data) => { if (!data.error) setSuggestions(data); })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false));
  }, [wizardMode, clientSlug, suggestions, suggestionsLoading]);

  async function persistGoals(next: GoalConfig[]) {
    await fetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: clientSlug, goals: next }),
    });
    onGoalsSaved();
  }

  async function handleWizardSubmit(values: WizardValues) {
    if (wizardMode === "adding") {
      const goal: GoalConfig = {
        id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `goal-${Date.now()}`,
        conversionType: values.conversionType,
        conversionValue: values.conversionValue,
        label: values.label || undefined,
        scopePagePath: values.scopePagePath || undefined,
      };
      await persistGoals([...goals, goal]);
    } else if (wizardMode !== "closed") {
      const id = wizardMode;
      const next = goals.map((g) =>
        g.id === id
          ? {
              id,
              conversionType: values.conversionType,
              conversionValue: values.conversionValue,
              label: values.label || undefined,
              scopePagePath: values.scopePagePath || undefined,
            }
          : g
      );
      await persistGoals(next);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await persistGoals(goals.filter((g) => g.id !== id));
    } finally {
      setDeletingId(null);
      setPendingDeleteId(null);
    }
  }

  if (loading && !ga) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2 text-[15px]">
        <Loader2 size={18} className="animate-spin" /> Loading the funnel…
      </div>
    );
  }

  if (!ga) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground text-[16px]">
          No website data yet for this range.
        </CardContent>
      </Card>
    );
  }

  const visited = ga.summary.sessions;
  const engagementPct = parsePercent(ga.summary.engagementRate);
  const engagedSessions = ga.summary.engagedSessions ?? Math.round(visited * (engagementPct / 100));
  const conversions = Array.isArray(ga.summary.conversions) ? ga.summary.conversions : [];

  const maxCount = Math.max(visited, engagedSessions, ...conversions.map((c) => c.count), 1);

  const foundSite = foundSiteInsight(ga.summary.sessionsChange, visited, ga.summary.previousSessions, ga.comparison?.label);
  const stuckAround = stuckAroundInsight(engagementPct, engagedSessions, visited);

  const SNIPPET_TYPES = ["click", "form_submit", "scroll_depth", "time_on_page"];
  const isFirstSnippetGoal = !goals.some((g) => SNIPPET_TYPES.includes(g.conversionType));
  const editingGoal = wizardMode !== "closed" && wizardMode !== "adding" ? goals.find((g) => g.id === wizardMode) : undefined;

  return (
    <div className="space-y-6">
      <div className="px-1">
        <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0394B2] mb-1.5">Lead funnel</div>
        <h2 className="font-headline text-[28px] text-[#001A2E]">From visitor to lead</h2>
        <p className="mt-1 text-[15px] text-muted-foreground max-w-2xl">
          How many people arrived, how many engaged, and how many took the action that counts as a lead.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-8 items-start">
        <div className="min-w-0 space-y-4">
          <div className="flex gap-4 items-stretch">
            <RailStep color={VISITOR_COLOR.solid} isFirst />
            <div className="flex-1 min-w-0">
              <StageCard
                icon={<Search size={17} />}
                title="Visitors"
                value={visited}
                note={`Sessions · last ${range}`}
                source="Google Analytics 4"
                widthPct={Math.max((visited / maxCount) * 100, 4)}
                insight={foundSite.insight}
                color={VISITOR_COLOR}
                onRefresh={onRefresh}
                refreshing={!!loading}
              />
            </div>
          </div>

          <div className="flex gap-4 items-stretch">
            <RailStep color={WARM_COLOR.solid} />
            <div className="flex-1 min-w-0">
              <StageCard
                icon={<Eye size={17} />}
                title="Warm"
                value={engagedSessions}
                note={`${engagementPct.toFixed(0)}% of sessions actively engaged, not just a quick look`}
                source="Google Analytics 4 · engaged sessions"
                dropOff={visited - engagedSessions}
                widthPct={Math.max((engagedSessions / maxCount) * 100, 4)}
                insight={stuckAround.insight}
                color={WARM_COLOR}
                onRefresh={onRefresh}
                refreshing={!!loading}
              />
            </div>
          </div>

          <div className="flex gap-4 items-stretch">
            <RailStep color={convertedColor(0).solid} isLast />
            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {conversions.map((conv, i) => {
                const isPendingDelete = pendingDeleteId === conv.id;
                const pctOfEngaged = engagedSessions > 0 ? Math.round((conv.count / engagedSessions) * 100) : 0;
                const goalType = goals.find((g) => g.id === conv.id)?.conversionType || "pageview";
                const GoalIcon = TYPE_ICONS[goalType];

                return (
                  <MiniGoalCard
                    key={conv.id}
                    icon={<GoalIcon size={14} />}
                    title={conv.label || conv.page}
                    count={conv.count}
                    widthPct={Math.max((conv.count / maxCount) * 100, 4)}
                    caption={`${pctOfEngaged}% of engaged sessions`}
                    color={convertedColor(i)}
                    onRefresh={onRefresh}
                    refreshing={!!loading}
                    onEdit={() => setWizardMode(conv.id)}
                    isPendingDelete={isPendingDelete}
                    deletingSelf={deletingId === conv.id}
                    onRequestDelete={() => setPendingDeleteId(conv.id)}
                    onConfirmDelete={() => handleDelete(conv.id)}
                    onCancelDelete={() => setPendingDeleteId(null)}
                    postHogUrl={postHogUrl}
                  />
                );
              })}

              <button
                onClick={() => setWizardMode("adding")}
                className="flex flex-col items-center justify-center gap-2 min-h-[164px] rounded-2xl border border-dashed border-[#001A2E]/20 bg-white/50 text-[14px] font-semibold text-[#001A2E]/80 hover:bg-white hover:border-[#159A5D]/50 hover:text-[#159A5D] transition-colors"
              >
                <span className="size-9 rounded-xl bg-[#E0F6EA] text-[#159A5D] flex items-center justify-center">
                  <Plus size={17} />
                </span>
                {conversions.length === 0 ? "Track your first lead event" : "Add a lead event"}
              </button>
            </div>
          </div>
        </div>

        <FunnelPanel
          visited={visited}
          engagedSessions={engagedSessions}
          foundSiteInsightText={foundSite.insight}
          stuckAroundInsightText={stuckAround.insight}
          conversions={conversions}
          maxCount={maxCount}
          range={range}
        />
      </div>

      {wizardMode !== "closed" && (
        <EventWizardModal
          clientSlug={clientSlug}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          initial={
            editingGoal
              ? {
                  conversionType: editingGoal.conversionType,
                  conversionValue: editingGoal.conversionValue,
                  label: editingGoal.label || "",
                  scopePagePath: editingGoal.scopePagePath || "",
                }
              : undefined
          }
          isFirstSnippetGoal={isFirstSnippetGoal}
          submitLabel={editingGoal ? "Save changes" : "Save & start tracking"}
          onSubmit={handleWizardSubmit}
          onClose={() => setWizardMode("closed")}
        />
      )}
    </div>
  );
}
