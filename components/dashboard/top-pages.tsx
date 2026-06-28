"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Gauge } from "lucide-react";

interface PageRow {
  page: string;
  views: number;
  engagementScore?: number;
  avgDuration?: number;
}

interface TopPagesProps {
  data: PageRow[];
  clarityEngagement?: any[];
}

function EngagementMeter({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-emerald-500" : score >= 45 ? "bg-[#0B4F6C]" : score >= 20 ? "bg-amber-400" : "bg-red-400";
  const textColor =
    score >= 70 ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
    score >= 45 ? "text-[#0B4F6C] bg-[#0B4F6C]/8 border-[#0B4F6C]/20" :
    score >= 20 ? "text-amber-700 bg-amber-50 border-amber-200" :
    "text-red-600 bg-red-50 border-red-200";

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-14 h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span
        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border tabular-nums ${textColor}`}
        title="GA4 Engagement Rate — % of sessions on this page where the user actively engaged (scrolled, clicked, or stayed 10+ seconds)"
      >
        {score}
      </span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function TopPages({ data }: TopPagesProps) {
  const max = Math.max(...data.map((d) => d.views), 1);
  const hasEngagement = data.some((d) => d.engagementScore !== undefined && d.engagementScore > 0);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-muted-foreground/60" />
          <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">Top Pages</CardTitle>
          {hasEngagement && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50">
              <Gauge size={10} />
              Engagement
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="space-y-3">
          {data.map((page) => {
            const score = page.engagementScore ?? 0;
            return (
              <div key={page.page} className="group">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[12px] font-medium text-foreground/80 truncate flex-1"
                    title={page.page}
                  >
                    {page.page === "/" ? "Home" : page.page}
                  </span>
                  {hasEngagement && <EngagementMeter score={score} />}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#0B4F6C]/50"
                      style={{ width: `${(page.views / max) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] tabular-nums text-muted-foreground w-10 text-right">
                      {page.views.toLocaleString()}
                    </span>
                    {page.avgDuration !== undefined && page.avgDuration > 0 && (
                      <span className="text-[10px] text-muted-foreground/50 tabular-nums w-10">
                        {formatDuration(page.avgDuration)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
