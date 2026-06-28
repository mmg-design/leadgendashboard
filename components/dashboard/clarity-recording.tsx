"use client";

import { Card, CardContent } from "@/components/ui/card";
import { MousePointerClick, ExternalLink, Scroll, Zap } from "lucide-react";

interface PageEngagement {
  page: string;
  engagementScore: number;
  totalSessions: number;
  scrollDepth?: number;
}

interface ClarityMetricsProps {
  topSessionUrl: string;
  projectId: string;
  pageEngagement?: PageEngagement[];
  rageClicks?: number;
  deadClicks?: number;
  homepageScrollDepth?: number | null;
}

export function ClarityRecordingLink({
  topSessionUrl,
  projectId,
  pageEngagement,
  rageClicks = 0,
  deadClicks = 0,
  homepageScrollDepth = null,
}: ClarityMetricsProps) {
  const topPages = pageEngagement?.slice(0, 5) || [];

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="py-4 flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-3">
          <div className="p-2 rounded-lg bg-[#0B4F6C]/8">
            <MousePointerClick size={16} className="text-[#0B4F6C]/70" />
          </div>
          <div className="text-[17px] font-headline font-normal text-foreground/80">
            Behavior Insights
          </div>
          <span className="ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
            Clarity
          </span>
        </div>

        {/* Quick stats row */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div
            className="rounded-lg bg-muted/30 p-2.5 text-center"
            title="Average % of the homepage users scrolled through. Higher = more content is being read."
          >
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Scroll size={11} className="text-[#0B4F6C]/60" />
              <span className="text-[18px] font-light text-foreground tabular-nums">
                {homepageScrollDepth !== null ? `${homepageScrollDepth}%` : "—"}
              </span>
            </div>
            <div className="text-[9px] text-muted-foreground leading-tight">Home scroll depth</div>
          </div>
          <div
            className={`rounded-lg p-2.5 text-center ${rageClicks > 0 ? "bg-amber-50" : "bg-muted/30"}`}
            title="Rage clicks = users rapidly clicking the same spot out of frustration. Signals broken links or buttons."
          >
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Zap size={11} className={rageClicks > 0 ? "text-amber-600" : "text-muted-foreground/40"} />
              <span className={`text-[18px] font-light tabular-nums ${rageClicks > 0 ? "text-amber-700" : "text-foreground"}`}>
                {rageClicks}
              </span>
            </div>
            <div className={`text-[9px] leading-tight ${rageClicks > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
              Rage clicks
            </div>
          </div>
          <div
            className={`rounded-lg p-2.5 text-center ${deadClicks > 0 ? "bg-orange-50" : "bg-muted/30"}`}
            title="Dead clicks = clicking on things that don't do anything. Signals confusing UI or broken elements."
          >
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <MousePointerClick size={11} className={deadClicks > 0 ? "text-orange-600" : "text-muted-foreground/40"} />
              <span className={`text-[18px] font-light tabular-nums ${deadClicks > 0 ? "text-orange-700" : "text-foreground"}`}>
                {deadClicks}
              </span>
            </div>
            <div className={`text-[9px] leading-tight ${deadClicks > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
              Dead clicks
            </div>
          </div>
        </div>

        {/* Per-page engagement scores */}
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          Engagement score by page
        </div>
        <div className="flex-1 space-y-1 mb-3">
          {topPages.length > 0 ? (
            topPages.map((page, i) => {
              const score = page.engagementScore;
              const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-[#0B4F6C]" : "bg-amber-400";
              return (
                <a
                  key={i}
                  href={`https://clarity.microsoft.com/projects/view/${projectId}/dashboard`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-muted/40 transition-colors group"
                  title={`Scroll depth: ${page.scrollDepth ?? "—"}% · ${page.totalSessions} sessions`}
                >
                  <span className="text-[10px] text-foreground/60 truncate flex-1">
                    {page.page.replace(/^https?:\/\/[^/]+/, "") || "/"}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="w-16 h-1 bg-muted/50 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
                    </div>
                    <span className="text-[10px] font-medium text-foreground/60 w-6 text-right tabular-nums">{score}</span>
                  </div>
                  <ExternalLink size={8} className="text-muted-foreground/20 group-hover:text-[#0B4F6C]/40 shrink-0" />
                </a>
              );
            })
          ) : (
            <div className="py-3 text-center text-[10px] text-muted-foreground/40">
              No page data yet
            </div>
          )}
        </div>

        <a
          href={topSessionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 text-[12px] font-medium rounded-lg bg-[#0B4F6C]/8 text-[#0B4F6C] hover:bg-[#0B4F6C]/15 transition-colors mt-auto"
        >
          Open Clarity Dashboard
          <ExternalLink size={11} />
        </a>
      </CardContent>
    </Card>
  );
}
