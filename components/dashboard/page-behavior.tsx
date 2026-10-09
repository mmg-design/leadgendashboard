"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MousePointerClick, ExternalLink, Info, Wrench, Megaphone } from "lucide-react";
import {
  LABEL_DEFINITIONS,
  pageActions,
  type ClaritySummary,
  type LabeledPage,
  type PageLabel,
} from "@/lib/page-behavior";
import { PageLabelPill } from "./page-label";

interface PageBehaviorProps {
  labeled: LabeledPage[];
  clarity: ClaritySummary | null;
  clarityEnabled: boolean;
  range: string;
}

function sourceNote(clarity: ClaritySummary | null, clarityEnabled: boolean, range: string) {
  if (!clarityEnabled) return "GA4 only";
  if (!clarity || clarity.daysCollected === 0) return "GA4 only for now";
  if (clarity.daysCollected < clarity.rangeDays) {
    return `GA4 + Clarity (${clarity.daysCollected} of ${clarity.rangeDays} days collected)`;
  }
  return `GA4 + Clarity, last ${range}`;
}

function clarityNotice(clarity: ClaritySummary | null, clarityEnabled: boolean): string | null {
  if (!clarityEnabled) {
    return "Connect Microsoft Clarity in Settings to add scroll depth and frustration signals (rage clicks, dead clicks) to these labels.";
  }
  if (!clarity) return null;
  if (clarity.status === "token_missing") {
    return "Labels use GA4 only. Add this client's Clarity API token in Settings to include scroll depth and frustration signals.";
  }
  if (clarity.status === "domain_mismatch") return clarity.message || null;
  if (clarity.status === "error" && clarity.daysCollected === 0) return clarity.message || null;
  if (clarity.status === "collecting" && clarity.daysCollected < 7) {
    return "Clarity keeps only the last 3 days, so the dashboard saves a copy each day. Labels get sharper as days add up.";
  }
  return null;
}

function Row({ page }: { page: LabeledPage }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-medium text-foreground/85 truncate" title={page.path}>
            {page.path === "/" ? "Home" : page.path}
          </span>
          {/* The Ignored tag stays hidden; the reason line below already says what's wrong. */}
          {page.label !== "Ignored" && <PageLabelPill label={page.label} />}
        </div>
        <p className="text-[14px] text-muted-foreground mt-1">{page.reason}</p>
      </div>
      <span className="text-[13px] tabular-nums text-muted-foreground shrink-0">
        {page.views.toLocaleString()} views
      </span>
    </div>
  );
}

export function PageBehavior({ labeled, clarity, clarityEnabled, range }: PageBehaviorProps) {
  const [showLegend, setShowLegend] = useState(false);
  const { fixFirst, promote } = pageActions(labeled);
  const notice = clarityNotice(clarity, clarityEnabled);
  const hasClarityData = !!clarity && clarity.daysCollected > 0;

  return (
    <Card>
      <CardContent className="py-1">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="p-2 rounded-lg bg-[#001A2E]/8">
            <MousePointerClick size={16} className="text-[#001A2E]/70" />
          </div>
          <div className="text-[22px] font-headline font-normal text-[#001A2E]">Page behavior</div>
          <button
            onClick={() => setShowLegend((v) => !v)}
            className="p-1 rounded-md text-[#097388]/60 hover:text-[#001A2E] hover:bg-muted/40 transition-colors"
            title="What the labels mean"
            aria-expanded={showLegend}
          >
            <Info size={13} />
          </button>
          <span className="ml-auto text-[12px] text-[#097388]/75">{sourceNote(clarity, clarityEnabled, range)}</span>
        </div>
        <p className="text-[15px] text-muted-foreground mb-4">
          Which pages to fix and which to send more people to, based on traffic and how visitors use each page.
        </p>

        {showLegend && (
          <div className="mb-3 rounded-lg bg-muted/30 p-3 space-y-1.5">
            {(["Strong", "Okay", "Leaking"] as PageLabel[]).map((label) => (
              <div key={label} className="flex items-start gap-2 text-[13px] text-foreground/75">
                <PageLabelPill label={label} />
                <span>{LABEL_DEFINITIONS[label]}</span>
              </div>
            ))}
          </div>
        )}

        {notice && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            {notice}
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-[#0394B2] mb-1">
              <Wrench size={12} /> Fix first
            </div>
            {fixFirst.length > 0 ? (
              <div className="divide-y divide-border/50">
                {fixFirst.map((p) => <Row key={p.path} page={p} />)}
              </div>
            ) : (
              <p className="text-[14px] text-muted-foreground py-2">
                Nothing urgent. Your busiest pages are holding visitors&apos; attention.
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-[#0394B2] mb-1">
              <Megaphone size={12} /> Worth promoting
            </div>
            {promote.length > 0 ? (
              <div className="divide-y divide-border/50">
                {promote.map((p) => <Row key={p.path} page={p} />)}
              </div>
            ) : (
              <p className="text-[14px] text-muted-foreground py-2">
                No under-visited page stands out yet. Pages that hold attention but get little traffic will show here.
              </p>
            )}
          </div>
        </div>

        {(hasClarityData || (clarityEnabled && clarity?.projectId)) && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50 text-[13px] text-muted-foreground">
            {hasClarityData && (
              <span>
                Sitewide, last {range}: {clarity!.rageClicks.toLocaleString()} rage clicks,{" "}
                {clarity!.deadClicks.toLocaleString()} dead clicks.
              </span>
            )}
            {clarity?.projectId && (
              <a
                href={clarity.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 font-medium text-[#0394B2] hover:text-[#001A2E] transition-colors"
              >
                Watch recordings in Clarity <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
