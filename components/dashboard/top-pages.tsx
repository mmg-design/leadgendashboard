"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { normalizePath, type LabeledPage } from "@/lib/page-behavior";
import { PageLabelPill } from "./page-label";

interface PageRow {
  page: string;
  views: number;
  engagementScore?: number;
  avgDuration?: number;
}

interface TopPagesProps {
  data: PageRow[];
  labels?: LabeledPage[];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function TopPages({ data, labels = [] }: TopPagesProps) {
  const max = Math.max(...data.map((d) => d.views), 1);
  const labelByPath = new Map(labels.map((l) => [l.path, l]));

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-[#097388]/75" />
          <CardTitle className="text-[22px] font-headline font-normal text-[#001A2E]">Top Pages</CardTitle>
          {labels.length > 0 && (
            <span className="ml-auto text-[12px] text-[#097388]/65">Hover a label for why</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="space-y-4">
          {data.map((page) => {
            const labeled = labelByPath.get(normalizePath(page.page));
            return (
              <div key={page.page} className="group">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[15px] font-medium text-foreground/85 truncate flex-1"
                    title={page.page}
                  >
                    {page.page === "/" ? "Home" : page.page}
                  </span>
                  {/* "Low data" stays out of this list; on a quiet week it would tag most rows. */}
                  {labeled && labeled.label !== "Low data" && (
                    <PageLabelPill label={labeled.label} reason={labeled.reason} />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#001A2E]/50"
                      style={{ width: `${(page.views / max) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[14px] font-semibold tabular-nums text-[#001A2E] w-12 text-right">
                      {page.views.toLocaleString()}
                    </span>
                    {page.avgDuration !== undefined && page.avgDuration > 0 && (
                      <span
                        className="text-[13px] text-muted-foreground tabular-nums w-14 whitespace-nowrap"
                        title="Average time on page"
                      >
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
