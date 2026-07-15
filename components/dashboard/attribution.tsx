"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { GoalConfig, ActionItemsState } from "@/lib/clients";
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
  GripVertical,
  AlertTriangle,
  Sparkles,
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
  actionItemsState: ActionItemsState;
  onGoalsSaved: () => void;
  onActionItemsSaved: () => void;
  onRefresh: () => void;
}

interface ActionItem {
  key: string;
  icon: React.ReactNode;
  text: string;
}

interface FunnelRecommendation {
  title: string;
  recommendation: string;
  evidence: string;
  impact: "high" | "medium" | "low";
}

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
  const left = Math.max(100 - pct, 0);
  const counts = `${engagedSessions.toLocaleString()} of ${visited.toLocaleString()}`;
  if (engagementPct >= 60) {
    return {
      insight: `${pct}% of visitors (${counts}) engaged meaningfully - well above typical.`,
      action: "See what's resonating in Top Pages on the Overview tab and lean into it.",
    };
  }
  if (engagementPct >= 40) {
    return {
      insight: `${pct}% of visitors (${counts}) engaged meaningfully; the other ${left}% left quickly.`,
      action: "Check scroll depth and rage clicks below for where people lose interest.",
    };
  }
  return {
    insight: `Only ${pct}% of visitors (${counts}) stuck around - most leave within seconds.`,
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
  widthPct: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Card className="py-4">
      <CardContent className="space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#0CA4C3] text-white shrink-0">{icon}</div>
            <div>
              <div className="font-headline text-[19px] font-normal leading-tight tracking-[-0.02em] text-[#001A2E]">{title}</div>
              <div className="text-[11px] text-[#097388]/75 uppercase tracking-wide">{source}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[26px] font-headline font-normal text-[#001A2E] leading-none">
              {value.toLocaleString()}
            </span>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title={`Refresh ${title.toLowerCase()}`}
              className="p-1 rounded-md text-[#0CA4C3] hover:text-white hover:bg-[#0CA4C3] transition-colors disabled:opacity-30"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-[#001A2E] transition-all"
              style={{ width: `${widthPct}%` }}
            />
          </div>
          <p className="text-[13px] text-muted-foreground mt-1.5">{note}</p>
          {dropOff !== undefined && dropOff > 0 && (
            <p className="text-[13px] text-amber-600 mt-1">
              {dropOff.toLocaleString()} people left before this step
            </p>
          )}
        </div>

        <p className="text-[13px] text-foreground/80 pt-2 border-t border-border/50">{insight}</p>
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
    <Card className="py-3">
      <CardContent className="p-2.5 space-y-1.5">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="p-1 rounded-md bg-[#0CA4C3] text-white shrink-0">
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
                  className="p-1 rounded-md text-[#0CA4C3] hover:text-white hover:bg-[#0CA4C3] transition-colors disabled:opacity-30"
                >
                  <RefreshCw size={10.5} className={refreshing ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={onEdit}
                  title="Edit"
                  className="p-1 rounded-md text-[#0CA4C3] hover:text-white hover:bg-[#0CA4C3] transition-colors"
                >
                  <Pencil size={10.5} />
                </button>
                <button
                  onClick={onRequestDelete}
                  title="Delete"
                  className="p-1 rounded-md text-[#0CA4C3] hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={10.5} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[24px] font-headline font-normal text-[#001A2E] leading-none">
            {count.toLocaleString()}
          </span>
          <span className="font-headline text-[17px] font-normal text-[#001A2E] leading-none">
            {count === 1 ? "Lead" : "Leads"}
          </span>
        </div>

        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-[#001A2E] transition-all" style={{ width: `${widthPct}%` }} />
        </div>

        <p className="text-[12px] text-muted-foreground leading-snug">{caption}</p>
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

const FUNNEL_SEGMENT_HEIGHT = 96;
const FUNNEL_WIDTH = 280;

// A smooth S-curve taper between one stage's width and the next, instead of a
// hard-angled trapezoid - reads as a flowing funnel rather than a stack of wedges.
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
      insight: tookActionInsight(
        c.count,
        c.change,
        engagedSessions > 0 ? Math.round((c.count / engagedSessions) * 100) : 0
      ).insight,
      color: branchColors[i % branchColors.length],
      sources: c.sources,
    })),
  ];

  // True proportional widths - only a thin floor so a zero-count stage still renders as a sliver, not nothing.
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
      <Card className="xl:sticky xl:top-8 py-4">
        <CardContent>
          <p className="font-headline text-[19px] font-normal text-[#001A2E] mb-1">The funnel</p>
          <p className="text-[13px] text-muted-foreground mb-3">Hover a stage for context</p>

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
                  <rect
                    x="40"
                    y={yMid + 2}
                    width="200"
                    height="22"
                    rx="11"
                    fill="white"
                    fillOpacity="0.94"
                  />
                  <text x={FUNNEL_WIDTH / 2} y={yMid + 17} textAnchor="middle" fill="#001A2E" fontSize="11.5" fontWeight="500">
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
        </CardContent>
      </Card>

      <div
        className={`fixed z-[60] w-80 p-4 rounded-xl bg-white border border-[#0CA4C3]/25 shadow-2xl shadow-[#0CA4C3]/10 pointer-events-none transition-all duration-200 ease-out ${
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
            <p className="text-[16px] font-semibold text-[#001A2E] mb-1.5">
              {hoveredStage.label} - {hoveredStage.count.toLocaleString()}
            </p>
            <p className="text-[15px] text-foreground/70 leading-relaxed">{hoveredStage.insight}</p>
            {hoveredStage.sources && hoveredStage.sources.length > 0 && (
              <div className="mt-2.5 pt-2.5 border-t border-[#0CA4C3]/20">
                <p className="text-[13px] font-medium text-[#0CA4C3] uppercase tracking-wide mb-1.5">
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
  actionItemsState,
  onGoalsSaved,
  onActionItemsSaved,
  onRefresh,
}: AttributionProps) {
  const [wizardMode, setWizardMode] = useState<"closed" | "adding" | string>("closed"); // string = editing goal id
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DiscoverResult | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [actionOrder, setActionOrder] = useState<string[]>(actionItemsState.order);
  const [dragActionKey, setDragActionKey] = useState<string | null>(null);
  const [dismissingActionKeys, setDismissingActionKeys] = useState<Set<string>>(new Set());
  const [recommendations, setRecommendations] = useState<FunnelRecommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [refreshingRecommendation, setRefreshingRecommendation] = useState<number | null>(null);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);

  async function generateRecommendations(replaceIndex?: number) {
    if (!ga) return;
    if (replaceIndex === undefined) setRecommendationsLoading(true);
    else setRefreshingRecommendation(replaceIndex);
    setRecommendationsError(null);
    try {
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "funnel-recommendations",
          clientSlug,
          range,
          ga,
          clarity,
          replaceIndex,
          existingRecommendations: recommendations.map((item) => item.title),
        }),
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.recommendations)) {
        throw new Error(data.error || "Could not generate recommendations");
      }
      if (replaceIndex === undefined) setRecommendations(data.recommendations);
      else setRecommendations((current) => current.map((item, i) => i === replaceIndex ? data.recommendations[0] : item));
    } catch (err) {
      setRecommendationsError(err instanceof Error ? err.message : "Could not generate recommendations");
    } finally {
      setRecommendationsLoading(false);
      setRefreshingRecommendation(null);
    }
  }

  useEffect(() => {
    if (wizardMode === "closed" || suggestions || suggestionsLoading) return;
    setSuggestionsLoading(true);
    fetch(`/api/ga/discover?client=${clientSlug}`)
      .then((r) => r.json())
      .then((data) => { if (!data.error) setSuggestions(data); })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false));
  }, [wizardMode, clientSlug, suggestions, suggestionsLoading]);

  // Reconcile local drag order once the server-persisted order actually changes
  // (e.g. on first load, or once our own PATCH round-trips back through props).
  useEffect(() => {
    setActionOrder(actionItemsState.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionItemsState.order.join("|")]);

  async function persistGoals(next: GoalConfig[]) {
    await fetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: clientSlug, goals: next }),
    });
    onGoalsSaved();
  }

  async function persistActionItemsState(next: ActionItemsState) {
    await fetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: clientSlug, actionItemsState: next }),
    });
    onActionItemsSaved();
  }

  function handleDismissActionItem(key: string) {
    setDismissingActionKeys((prev) => new Set(prev).add(key));
    persistActionItemsState({ dismissed: [...actionItemsState.dismissed, key], order: actionOrder });
  }

  function handleActionDragStart(key: string) {
    setDragActionKey(key);
  }

  function handleActionDragOver(e: React.DragEvent, overKey: string, visibleKeys: string[]) {
    e.preventDefault();
    if (!dragActionKey || dragActionKey === overKey) return;
    const fromIndex = visibleKeys.indexOf(dragActionKey);
    const toIndex = visibleKeys.indexOf(overKey);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = [...visibleKeys];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setActionOrder(next);
  }

  function handleActionDragEnd() {
    setDragActionKey(null);
    persistActionItemsState({ dismissed: actionItemsState.dismissed, order: actionOrder });
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
        <Loader2 size={18} className="animate-spin" /> Loading the road...
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

  const actionItems: ActionItem[] = [
    { key: "traffic", icon: <Search size={14} />, text: foundSite.action },
    { key: "engagement", icon: <Eye size={14} />, text: stuckAround.action },
    ...conversions.map((c) => {
      const pctOfEngaged = engagedSessions > 0 ? Math.round((c.count / engagedSessions) * 100) : 0;
      const goalType = goals.find((g) => g.id === c.id)?.conversionType || "pageview";
      const GoalIcon = TYPE_ICONS[goalType];
      return {
        key: `conversion-${c.id}`,
        icon: <GoalIcon size={14} />,
        text: tookActionInsight(c.count, c.change, pctOfEngaged).action,
      };
    }),
    ...(clarity?.homepageScrollDepth != null && clarity.homepageScrollDepth < 50
      ? [{
          key: "scroll-depth",
          icon: <AlertTriangle size={14} />,
          text: "Homepage scroll depth is low - revisit the headline and first section above the fold.",
        }]
      : []),
    ...((clarity?.rageClicks ?? 0) > 0
      ? [{
          key: "rage-clicks",
          icon: <AlertTriangle size={14} />,
          text: "People are rage-clicking something sitewide - find what looks clickable but doesn't work and fix it.",
        }]
      : []),
    ...((clarity?.deadClicks ?? 0) > 0
      ? [{
          key: "dead-clicks",
          icon: <AlertTriangle size={14} />,
          text: "People are clicking things sitewide that aren't real buttons or links - consider making them interactive.",
        }]
      : []),
  ];

  const actionItemsByKey = new Map(actionItems.map((item) => [item.key, item]));
  const orderedActionKeys = [
    ...actionOrder.filter((k) => actionItemsByKey.has(k)),
    ...actionItems.map((i) => i.key).filter((k) => !actionOrder.includes(k)),
  ];
  const visibleActionKeys = orderedActionKeys.filter(
    (k) => !actionItemsState.dismissed.includes(k) && !dismissingActionKeys.has(k)
  );

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
                className="flex flex-col items-center justify-center gap-1.5 min-h-[128px] text-[14px] font-medium text-[#001A2E] border border-dashed border-[#001A2E]/25 rounded-lg hover:bg-[#001A2E]/[0.03] hover:border-[#001A2E]/40 transition-colors"
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
                <p className="text-[15px] font-medium text-foreground/80">What might be slowing people down</p>
                <span className="text-[12px] text-[#097388]/75 uppercase tracking-wide">
                  Source: Microsoft Clarity, site-wide, last 30 days
                </span>
              </div>
              <div className="space-y-2 text-[15px] text-foreground/80">
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
                    repeatedly - usually a sign something looked clickable but didn&apos;t work.
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

        {(visibleActionKeys.length > 0 || recommendations.length > 0) && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4 px-1">
              <div>
                <p className="text-[15px] font-medium text-foreground/80">What to do next</p>
                <p className="text-[12px] text-muted-foreground">Gemini analyzes the live funnel, GA history, behavior data, and public site messaging.</p>
              </div>
              <button
                onClick={() => generateRecommendations()}
                disabled={recommendationsLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#001A2E] text-white text-[12px] font-medium hover:bg-[#01384C] disabled:opacity-50"
              >
                {recommendationsLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {recommendations.length ? "Refresh all" : "Generate recommendations"}
              </button>
            </div>

            {recommendationsError && (
              <p className="text-[13px] text-red-600 px-1">{recommendationsError}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recommendations.length > 0 ? recommendations.map((item, index) => (
                <Card key={`${item.title}-${index}`} className="py-0 overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkles size={14} className="text-[#0CA4C3] shrink-0" />
                        <p className="font-medium text-[14px] text-[#001A2E] leading-snug">{item.title}</p>
                      </div>
                      <button
                        onClick={() => generateRecommendations(index)}
                        disabled={refreshingRecommendation !== null}
                        title="Generate a different recommendation"
                        className="p-1.5 rounded-md text-[#0CA4C3] hover:text-white hover:bg-[#0CA4C3] disabled:opacity-40 shrink-0"
                      >
                        <RefreshCw size={12} className={refreshingRecommendation === index ? "animate-spin" : ""} />
                      </button>
                    </div>
                    <p className="text-[13px] text-foreground/80 leading-relaxed">{item.recommendation}</p>
                    <div className="pt-2 border-t border-border/60 flex items-start justify-between gap-3">
                      <p className="text-[11.5px] text-muted-foreground leading-relaxed"><span className="font-medium text-foreground/65">Why:</span> {item.evidence}</p>
                      <span className={`text-[10px] uppercase tracking-wide font-semibold shrink-0 ${item.impact === "high" ? "text-emerald-700" : item.impact === "medium" ? "text-amber-700" : "text-muted-foreground"}`}>{item.impact} impact</span>
                    </div>
                  </CardContent>
                </Card>
              )) : visibleActionKeys.map((key) => {
                const item = actionItemsByKey.get(key)!;
                return (
                  <Card key={key} className="py-0 group">
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className="text-[#0CA4C3] mt-0.5 shrink-0">{item.icon}</div>
                      <p className="flex-1 text-[13px] text-foreground/80 leading-relaxed">{item.text}</p>
                      <button onClick={() => generateRecommendations()} title="Refresh with Gemini" className="p-1 rounded-md text-[#0CA4C3] hover:bg-[#0CA4C3] hover:text-white shrink-0">
                        <RefreshCw size={12} />
                      </button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
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
