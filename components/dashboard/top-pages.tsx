"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Gauge } from "lucide-react";

interface ClarityPageData {
  page: string;
  engagementScore: number;
  totalSessions: number;
}

interface TopPagesProps {
  data: { page: string; views: number }[];
  clarityEngagement?: ClarityPageData[];
}

function getEngagementColor(score: number) {
  if (score >= 70) return "text-emerald-600 bg-emerald-50 border-emerald-200";
  if (score >= 40) return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-red-500 bg-red-50 border-red-200";
}

function matchPageToClarity(gaPage: string, clarityPages: ClarityPageData[]): ClarityPageData | null {
  // Clarity URLs are full URLs, GA pages are paths — try matching by path suffix
  for (const cp of clarityPages) {
    try {
      const url = new URL(cp.page);
      if (url.pathname === gaPage || url.pathname === gaPage + "/") {
        return cp;
      }
    } catch {
      // If it's not a full URL, try direct match
      if (cp.page === gaPage) return cp;
    }
  }
  return null;
}

export function TopPages({ data, clarityEngagement }: TopPagesProps) {
  const max = Math.max(...data.map((d) => d.views));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-muted-foreground/60" />
          <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">Top Pages</CardTitle>
          {clarityEngagement && clarityEngagement.length > 0 && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50">
              <Gauge size={10} />
              Engagement via Clarity
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.map((page, index) => {
            const clarityMatch = clarityEngagement?.length
              ? matchPageToClarity(page.page, clarityEngagement)
              : null;
            const showEngagement = index < 3 && clarityMatch;

            return (
              <div key={page.page} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-[13px] font-medium text-foreground/80 truncate">
                      {page.page}
                    </div>
                    {showEngagement && (
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getEngagementColor(clarityMatch.engagementScore)}`}
                        title={`Clarity engagement score: ${clarityMatch.engagementScore}/100 (${clarityMatch.totalSessions} sessions)`}
                      >
                        <Gauge size={9} />
                        {clarityMatch.engagementScore}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#0B4F6C]/60"
                      style={{ width: `${(page.views / max) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-[13px] font-medium tabular-nums w-12 text-right text-muted-foreground">
                  {page.views}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
