"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { GoalConfig } from "@/lib/clients";
import { EventWizardModal, TYPE_ICONS, type WizardValues } from "@/components/dashboard/event-wizard-modal";
import {
  Search,
  Eye,
  TrendingUp,
  TrendingDown,
  Loader2,
  Check,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

interface ConversionResult {
  id: string;
  page: string;
  label?: string;
  count: number;
  change: number | null;
  sources?: { source: string; count: number }[];
}

interface AttributionGAData {
  summary: {
    sessions: number;
    sessionsChange?: number | null;
    engagementRate?: string;
    engagedSessions?: number;
    conversions: ConversionResult[];
  };
}

interface AttributionClarityData {
  homepageScrollDepth?: number | null;
  rageClicks?: number;
  deadClicks?: number;
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
  clarity: AttributionClarityData | null;
  loading?: boolean;
  range: string;
  onGoalsSaved: () => void;
  onRefresh: () => void;
}

function parsePercent(value?: string): number {
  if (!value) return 0;
  const n = parseFloat(value.replace("%", ""));
  return isNaN(n) ? 0 : n;
}

function foundSiteInsight(sessionsChange: number | null | undefined) {
  if (sessionsChange === null || sessionsChange === undefined) {
    return {
      insight: "Not enough history yet to compare against the previous period.",
      action: "Check back next period to see the trend.",
    };
  }
  if (sessionsChange <= -10) {
    return {
      insight: `Traffic dropped ${Math.abs(sessionsChange)}% compared to the previous period.`,
      action: "Check recent search rankings and any paused campaigns for what changed.",
    };
  }
  if (sessionsChange >= 10) {
    return {
      insight: `Traffic grew ${sessionsChange}% compared to the previous period.`,
      action: "Find out what's driving the increase and double down on it.",
    };
  }
  return {
    insight: "Traffic has held roughly steady compared to the previous period.",
    action: "Traffic is stable — focus effort on the steps below instead.",
  };
}

function stuckAroundInsight(engagementPct: number) {
  if (engagementPct >= 60) {
    return {
      insight: "Most visitors are actively engaging, not just glancing and leaving.",
      action: "See what's resonating in Top Pages on the Overview tab and lean into it.",
    };
  }
  if (engagementPct >= 40) {
    return {
      insight: "About half of visitors engage meaningfully — the rest leave quickly.",
      action: "Check scroll depth and rage clicks below for where people lose interest.",
    };
  }
  return {
    insight: "Most visitors leave without real engagement.",
    action: "The message above the fold likely isn't landing — revisit the headline and first section.",
  };
}

function tookActionInsight(converted: number, change: number | null) {
  if (converted === 0) {
    return {
      insight: "No conversions recorded yet this period.",
      action: "Double-check the tracked page or event is still firing correctly.",
    };
  }
  if (change === null) {
    return {
      insight: "Not enough history yet to compare against the previous period.",
      action: "Check back next period to see whether this is trending up or down.",
    };
  }
  if (change < 0) {
    return {
      insight: `Down ${Math.abs(change)}% compared to the previous period.`,
      action: "Check whether traffic to the money pages dropped, or the conversion step broke.",
    };
  }
  return {
    insight: `Up ${change}% compared to the previous period.`,
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
// actually arrived — this is GA4 attribution data, not anything from Clarity.
function describeJourney(sourceMedium: string): string {
  const [rawSource, rawMedium] = sourceMedium.split(" / ").map((s) => s.trim());
  const source = rawSource || "an unknown source";
  const medium = (rawMedium || "").toLowerCase();
  const prettySource = prettySourceName(source);

  if (source === "(direct)" || medium === "(none)") {
    return "Went straight to the site — typed the URL directly or used a bookmark";
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
      <div className="w-3 h-3 rounded-full shrink-0 ring-[3px] ring-background" style={{ backgroundColor: color }} />
      <div className={`w-0.5 flex-1 ${isLast ? "bg-transparent" : "bg-border"}`} />
    </div>
  );
}

function StageCard({
  icon,
  title,
  value,
  note,
  source,
  dropOff,
  insight,
  action,
  widthPct,
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
  action: string;
  widthPct: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#001A2E]/8 text-[#001A2E] shrink-0">{icon}</div>
            <div>
              <div className="text-[13px] font-medium text-foreground/80">{title}</div>
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">{source}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[24px] font-headline font-normal text-[#001A2E] leading-none">
              {value.toLocaleString()}
            </span>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title={`Refresh ${title.toLowerCase()}`}
              className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-30"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-[#001A2E] transition-all"
              style={{ width: `${widthPct}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">{note}</p>
          {dropOff !== undefined && dropOff > 0 && (
            <p className="text-[11px] text-amber-600 mt-1">
              {dropOff.toLocaleString()} people left before this step
            </p>
          )}
        </div>

        <div className="pt-2.5 border-t border-border/50 space-y-1">
          <p className="text-[12px] text-foreground/80">{insight}</p>
          <p className="text-[12px] text-[#001A2E] font-medium">→ {action}</p>
        </div>
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
  onRefresh,
  refreshing,
  onEdit,
  isPendingDelete,
  deletingSelf,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  widthPct: number;
  caption: string;
  onRefresh: () => void;
  refreshing: boolean;
  onEdit: () => void;
  isPendingDelete: boolean;
  deletingSelf: boolean;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="p-1 rounded-md bg-[#001A2E]/8 text-[#001A2E] shrink-0">
              {icon}
            </div>
            <span className="text-[11.5px] font-medium text-foreground/80 truncate" title={title}>
              {title}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {isPendingDelete ? (
              <>
                <button
                  onClick={onConfirmDelete}
                  disabled={deletingSelf}
                  title="Confirm delete"
                  className="p-1 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  {deletingSelf ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                </button>
                <button
                  onClick={onCancelDelete}
                  title="Cancel"
                  className="p-1 rounded-md text-muted-foreground hover:bg-muted/60 transition-colors"
                >
                  <X size={11} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onRefresh}
                  disabled={refreshing}
                  title="Refresh"
                  className="p-1 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-30"
                >
                  <RefreshCw size={10.5} className={refreshing ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={onEdit}
                  title="Edit"
                  className="p-1 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40 transition-colors"
                >
                  <Pencil size={10.5} />
                </button>
                <button
                  onClick={onRequestDelete}
                  title="Delete"
                  className="p-1 rounded-md text-muted-foreground/50 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={10.5} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-headline font-normal text-[#001A2E] leading-none">
            {count.toLocaleString()}
          </span>
          <span className="text-[9.5px] font-medium text-muted-foreground uppercase tracking-wide">
            {count === 1 ? "Lead" : "Leads"}
          </span>
        </div>

        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-[#001A2E] transition-all" style={{ width: `${widthPct}%` }} />
        </div>

        <p className="text-[10px] text-muted-foreground leading-snug">{caption}</p>
      </CardContent>
    </Card>
  );
}

interface FunnelStageDatum {
  label: string;
  count: number;
  insight: string;
  color: string;
  sources?: { source: string; count: number }[];
}

const FUNNEL_SEGMENT_HEIGHT = 88;
const FUNNEL_WIDTH = 280;

// A smooth S-curve taper between one stage's width and the next, instead of a
// hard-angled trapezoid — reads as a flowing funnel rather than a stack of wedges.
function curvySegmentPath(topPct: number, bottomPct: number, yTop: number): string {
  const yBot = yTop + FUNNEL_SEGMENT_HEIGHT;
  const yMid = yTop + FUNNEL_SEGMENT_HEIGHT / 2;
  const topW = (topPct / 100) * FUNNEL_WIDTH;
  const botW = (bottomPct / 100) * FUNNEL_WIDTH;
  const topL = (FUNNEL_WIDTH - topW) / 2;
  const topR = FUNNEL_WIDTH - topL;
  const botL = (FUNNEL_WIDTH - botW) / 2;
  const botR = FUNNEL_WIDTH - botL;
  return `M ${topL},${yTop} C ${topL},${yMid} ${botL},${yMid} ${botL},${yBot} L ${botR},${yBot} C ${botR},${yMid} ${topR},${yMid} ${topR},${yTop} Z`;
}

function FunnelPanel({
  visited,
  engagedSessions,
  foundSiteInsightText,
  stuckAroundInsightText,
  conversions,
  maxCount,
}: {
  visited: number;
  engagedSessions: number;
  foundSiteInsightText: string;
  stuckAroundInsightText: string;
  conversions: ConversionResult[];
  maxCount: number;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [hoveredStage, setHoveredStage] = useState<FunnelStageDatum | null>(null);
  const branchColors = ["#0CA4C3", "#45D7DF", "#72E1E6", "#A5EDF0"];

  const stages: FunnelStageDatum[] = [
    { label: "Visitors", count: visited, insight: foundSiteInsightText, color: "#001A2E" },
    { label: "Warm", count: engagedSessions, insight: stuckAroundInsightText, color: "#0394B2" },
    ...conversions.map((c, i) => ({
      label: c.label || c.page,
      count: c.count,
      insight: tookActionInsight(c.count, c.change).insight,
      color: branchColors[i % branchColors.length],
      sources: c.sources,
    })),
  ];

  // True proportional widths — only a thin floor so a zero-count stage still renders as a sliver, not nothing.
  function widthPctFor(count: number): number {
    return Math.max((count / maxCount) * 100, 6);
  }

  function handleEnter(e: React.MouseEvent<SVGGElement>, stage: FunnelStageDatum) {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.left - 16 });
    setHoveredStage(stage);
    setTooltipVisible(true);
  }

  function handleLeave() {
    setTooltipVisible(false);
  }

  const svgHeight = stages.length * FUNNEL_SEGMENT_HEIGHT;

  return (
    <>
      <Card className="xl:sticky xl:top-8">
        <CardContent className="pt-5">
          <p className="text-[13px] font-medium text-foreground/80 mb-1">The funnel</p>
          <p className="text-[11px] text-muted-foreground mb-4">Hover a stage for context</p>

          <svg viewBox={`0 0 ${FUNNEL_WIDTH} ${svgHeight}`} width="100%" height={svgHeight} className="overflow-visible">
            {stages.map((stage, i) => {
              const widthPct = widthPctFor(stage.count);
              const prevWidthPct = i === 0 ? 100 : widthPctFor(stages[i - 1].count);
              const yTop = i * FUNNEL_SEGMENT_HEIGHT;
              const yMid = yTop + FUNNEL_SEGMENT_HEIGHT / 2;
              const path = curvySegmentPath(prevWidthPct, widthPct, yTop);
              const label = stage.label.length > 28 ? `${stage.label.slice(0, 26)}…` : stage.label;
              return (
                <g
                  key={stage.label + i}
                  onMouseEnter={(e) => handleEnter(e, stage)}
                  onMouseLeave={handleLeave}
                  className="cursor-default"
                >
                  <path d={path} fill={stage.color} className="transition-opacity duration-150 hover:opacity-90" />
                  <text
                    x={FUNNEL_WIDTH / 2}
                    y={yMid - 6}
                    textAnchor="middle"
                    fill="white"
                    fontSize="21"
                    fontWeight="500"
                  >
                    {stage.count.toLocaleString()}
                  </text>
                  <text x={FUNNEL_WIDTH / 2} y={yMid + 15} textAnchor="middle" fill="white" fontSize="11" opacity="0.9">
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
        </CardContent>
      </Card>

      <div
        className={`fixed z-[60] w-80 p-4 rounded-xl bg-white border border-border/60 shadow-2xl pointer-events-none transition-all duration-200 ease-out ${
          tooltipVisible ? "opacity-100" : "opacity-0"
        }`}
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          transform: `translate(-100%, -50%) scale(${tooltipVisible ? 1 : 0.95})`,
        }}
      >
        {hoveredStage && (
          <>
            <p className="text-[14px] font-semibold text-[#001A2E] mb-1.5">
              {hoveredStage.label} — {hoveredStage.count.toLocaleString()}
            </p>
            <p className="text-[13px] text-foreground/70 leading-relaxed">{hoveredStage.insight}</p>
            {hoveredStage.sources && hoveredStage.sources.length > 0 && (
              <div className="mt-2.5 pt-2.5 border-t border-border/50">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  How they got here
                </p>
                <div className="space-y-1.5">
                  {hoveredStage.sources.map((s) => (
                    <p key={s.source} className="text-[12.5px] text-foreground/80 leading-snug">
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
  clarity,
  loading,
  range,
  onGoalsSaved,
  onRefresh,
}: AttributionProps) {
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
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2 text-[13px]">
        <Loader2 size={18} className="animate-spin" /> Loading the road...
      </div>
    );
  }

  if (!ga) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground text-[14px]">
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

  const foundSite = foundSiteInsight(ga.summary.sessionsChange);
  const stuckAround = stuckAroundInsight(engagementPct);

  const SNIPPET_TYPES = ["click", "form_submit", "scroll_depth", "time_on_page"];
  const isFirstSnippetGoal = !goals.some((g) => SNIPPET_TYPES.includes(g.conversionType));
  const editingGoal = wizardMode !== "closed" && wizardMode !== "adding" ? goals.find((g) => g.id === wizardMode) : undefined;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
      <div className="min-w-0 space-y-6">
        <div className="space-y-4">
          <div className="flex gap-3 items-stretch">
            <RailStep color="#001A2E" isFirst />
            <div className="flex-1 min-w-0">
              <StageCard
                icon={<Search size={16} />}
                title="Visitors"
                value={visited}
                note={`Sessions · Last ${range}`}
                source="Source: Google Analytics 4"
                widthPct={Math.max((visited / maxCount) * 100, 6)}
                insight={foundSite.insight}
                action={foundSite.action}
                onRefresh={onRefresh}
                refreshing={!!loading}
              />
            </div>
          </div>

          <div className="flex gap-3 items-stretch">
            <RailStep color="#0394B2" />
            <div className="flex-1 min-w-0">
              <StageCard
                icon={<Eye size={16} />}
                title="Warm"
                value={engagedSessions}
                note={`${engagementPct.toFixed(0)}% of sessions were actively engaged, not just a quick look`}
                source="Source: Google Analytics 4 (engaged sessions)"
                dropOff={visited - engagedSessions}
                widthPct={Math.max((engagedSessions / maxCount) * 100, 6)}
                insight={stuckAround.insight}
                action={stuckAround.action}
                onRefresh={onRefresh}
                refreshing={!!loading}
              />
            </div>
          </div>

          <div className="flex gap-3 items-stretch">
            <RailStep color="#0CA4C3" isLast />
            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {conversions.map((conv) => {
                const isPendingDelete = pendingDeleteId === conv.id;
                const pctOfEngaged = engagedSessions > 0 ? Math.round((conv.count / engagedSessions) * 100) : 0;
                const goalType = goals.find((g) => g.id === conv.id)?.conversionType || "pageview";
                const GoalIcon = TYPE_ICONS[goalType];

                return (
                  <MiniGoalCard
                    key={conv.id}
                    icon={<GoalIcon size={11} />}
                    title={conv.label || conv.page}
                    count={conv.count}
                    widthPct={Math.max((conv.count / maxCount) * 100, 6)}
                    caption={`${pctOfEngaged}% of engaged sessions`}
                    onRefresh={onRefresh}
                    refreshing={!!loading}
                    onEdit={() => setWizardMode(conv.id)}
                    isPendingDelete={isPendingDelete}
                    deletingSelf={deletingId === conv.id}
                    onRequestDelete={() => setPendingDeleteId(conv.id)}
                    onConfirmDelete={() => handleDelete(conv.id)}
                    onCancelDelete={() => setPendingDeleteId(null)}
                  />
                );
              })}

              <button
                onClick={() => setWizardMode("adding")}
                className="flex flex-col items-center justify-center gap-1.5 min-h-[128px] text-[12px] font-medium text-[#001A2E] border border-dashed border-[#001A2E]/25 rounded-lg hover:bg-[#001A2E]/[0.03] hover:border-[#001A2E]/40 transition-colors"
              >
                <Plus size={16} />
                {conversions.length === 0 ? "Create a new conversion event" : "Add another"}
              </button>
            </div>
          </div>
        </div>

        {(clarity?.homepageScrollDepth != null ||
          (clarity?.rageClicks ?? 0) > 0 ||
          (clarity?.deadClicks ?? 0) > 0) && (
          <Card>
            <CardContent className="pt-5 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-foreground/80">What might be slowing people down</p>
                <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                  Source: Microsoft Clarity, site-wide, last 30 days
                </span>
              </div>
              <div className="space-y-2 text-[13px] text-foreground/80">
                {clarity?.homepageScrollDepth != null && (
                  <p>
                    On the homepage specifically, people only scroll about{" "}
                    <strong>{Math.round(clarity.homepageScrollDepth)}%</strong> of the way down before
                    leaving.
                  </p>
                )}
                {(clarity?.rageClicks ?? 0) > 0 && (
                  <p>
                    <strong>{clarity!.rageClicks}</strong> people sitewide clicked something rapidly and
                    repeatedly — usually a sign something looked clickable but didn&apos;t work.
                  </p>
                )}
                {(clarity?.deadClicks ?? 0) > 0 && (
                  <p>
                    <strong>{clarity!.deadClicks}</strong> people sitewide clicked on something that
                    wasn&apos;t actually a button or link.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {conversions.some((c) => c.change !== null) && (
          <Card>
            <CardContent className="pt-5 space-y-2">
              {conversions
                .filter((c) => c.change !== null)
                .map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-[13px]">
                    {c.change! >= 0 ? (
                      <TrendingUp size={16} className="text-emerald-600 shrink-0" />
                    ) : (
                      <TrendingDown size={16} className="text-red-600 shrink-0" />
                    )}
                    <span>
                      {c.label || c.page}: {c.change! >= 0 ? "up" : "down"}{" "}
                      <strong>{Math.abs(c.change!)}%</strong> compared to the previous period.
                    </span>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}
      </div>

      <FunnelPanel
        visited={visited}
        engagedSessions={engagedSessions}
        foundSiteInsightText={foundSite.insight}
        stuckAroundInsightText={stuckAround.insight}
        conversions={conversions}
        maxCount={maxCount}
      />

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
