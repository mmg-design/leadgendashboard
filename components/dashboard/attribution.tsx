"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search,
  Eye,
  Trophy,
  TrendingUp,
  TrendingDown,
  Loader2,
  Check,
  RefreshCw,
} from "lucide-react";

interface AttributionGAData {
  summary: {
    sessions: number;
    sessionsChange?: number | null;
    engagementRate?: string;
    engagedSessions?: number;
    conversions?: { page: string; label?: string; count: number; change: number | null } | null;
  };
}

interface AttributionClarityData {
  homepageScrollDepth?: number | null;
  rageClicks?: number;
  deadClicks?: number;
}

interface AttributionProps {
  clientSlug: string;
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
      insight: `Conversions are down ${Math.abs(change)}% compared to the previous period.`,
      action: "Check whether traffic to the money pages dropped, or the conversion step broke.",
    };
  }
  return {
    insight: `Conversions are up ${change}% compared to the previous period.`,
    action: "See which traffic sources are driving these and invest more there.",
  };
}

function GoalSetupForm({ clientSlug, onSaved }: { clientSlug: string; onSaved: () => void }) {
  const [conversionType, setConversionType] = useState<"pageview" | "event">("pageview");
  const [conversionValue, setConversionValue] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!conversionValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: clientSlug,
          goals: {
            conversionType,
            conversionValue: conversionValue.trim(),
            label: label.trim() || undefined,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 rounded-lg bg-muted/40 border border-border/60 space-y-4">
      <div>
        <p className="text-[13px] font-medium text-foreground/80 mb-0.5">
          Conversion tracking isn&apos;t set up for this client yet
        </p>
        <p className="text-[12px] text-muted-foreground">
          Tell us how you know someone converted, and we&apos;ll show the last step of the road.
        </p>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-[12px] cursor-pointer">
          <input
            type="radio"
            checked={conversionType === "pageview"}
            onChange={() => setConversionType("pageview")}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-foreground/80">A page loads</span>
            <span className="text-muted-foreground"> — like a thank-you or confirmation page</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[12px] cursor-pointer">
          <input
            type="radio"
            checked={conversionType === "event"}
            onChange={() => setConversionType("event")}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-foreground/80">A specific action already fires</span>
            <span className="text-muted-foreground"> — like a form submit event in GA4</span>
          </span>
        </label>
      </div>

      <div>
        <label className="text-[11px] font-medium text-foreground/70 mb-1 block">
          {conversionType === "pageview" ? "Page path" : "GA4 event name"}
        </label>
        <input
          type="text"
          value={conversionValue}
          onChange={(e) => setConversionValue(e.target.value)}
          placeholder={conversionType === "pageview" ? "/thank-you" : "form_submit"}
          className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
        />
      </div>

      <div>
        <label className="text-[11px] font-medium text-foreground/70 mb-1 block">
          What do you call this? (optional)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Booked a call"
          className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
        />
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving || !conversionValue.trim()}
        className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-white bg-[#0B4F6C] rounded-lg hover:bg-[#0B4F6C]/90 disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
        {saving ? "Saving..." : saved ? "Saved!" : "Save & start tracking"}
      </button>
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
            <div className="p-2 rounded-lg bg-[#0B4F6C]/8 text-[#0B4F6C] shrink-0">{icon}</div>
            <div>
              <div className="text-[13px] font-medium text-foreground/80">{title}</div>
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">{source}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[24px] font-headline font-normal text-[#0B4F6C] leading-none">
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
              className="h-full rounded-full bg-[#0B4F6C] transition-all"
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
          <p className="text-[12px] text-[#0B4F6C] font-medium">→ {action}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function Attribution({
  clientSlug,
  ga,
  clarity,
  loading,
  range,
  onGoalsSaved,
  onRefresh,
}: AttributionProps) {
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
  const conversions = ga.summary.conversions;
  const converted = conversions?.count ?? null;

  const maxCount = Math.max(visited, engagedSessions, converted ?? 0, 1);

  const foundSite = foundSiteInsight(ga.summary.sessionsChange);
  const stuckAround = stuckAroundInsight(engagementPct);
  const tookAction = converted !== null ? tookActionInsight(converted, conversions?.change ?? null) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <StageCard
          icon={<Search size={16} />}
          title="Found the site"
          value={visited}
          note={`Sessions · Last ${range}`}
          source="Source: Google Analytics 4"
          widthPct={Math.max((visited / maxCount) * 100, 6)}
          insight={foundSite.insight}
          action={foundSite.action}
          onRefresh={onRefresh}
          refreshing={!!loading}
        />

        <StageCard
          icon={<Eye size={16} />}
          title="Stuck around"
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

        {converted !== null && tookAction ? (
          <StageCard
            icon={<Trophy size={16} />}
            title="Took action"
            value={converted}
            note={conversions?.label || (conversions?.page ? `Reached ${conversions.page}` : "Converted")}
            source="Source: Google Analytics 4 (tracked conversion event)"
            dropOff={engagedSessions - converted}
            widthPct={Math.max((converted / maxCount) * 100, 6)}
            insight={tookAction.insight}
            action={tookAction.action}
            onRefresh={onRefresh}
            refreshing={!!loading}
          />
        ) : (
          <Card>
            <CardContent className="pt-5">
              <GoalSetupForm clientSlug={clientSlug} onSaved={onGoalsSaved} />
            </CardContent>
          </Card>
        )}
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

      {conversions?.change !== null && conversions?.change !== undefined && (
        <Card>
          <CardContent className="py-4 flex items-center gap-2 text-[13px]">
            {conversions.change >= 0 ? (
              <TrendingUp size={16} className="text-emerald-600" />
            ) : (
              <TrendingDown size={16} className="text-red-600" />
            )}
            <span>
              Conversions are {conversions.change >= 0 ? "up" : "down"}{" "}
              <strong>{Math.abs(conversions.change)}%</strong> compared to the previous period.
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
