"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Video, ExternalLink, BarChart3 } from "lucide-react";

interface PageEngagement {
  page: string;
  engagementScore: number;
  totalSessions: number;
}

interface ClarityRecordingProps {
  topSessionUrl: string;
  projectId: string;
  pageEngagement?: PageEngagement[];
}

export function ClarityRecordingLink({ topSessionUrl, projectId, pageEngagement }: ClarityRecordingProps) {
  const topPages = pageEngagement?.slice(0, 4) || [];

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="py-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="p-2 rounded-lg bg-[#0B4F6C]/8">
            <Video size={16} className="text-[#0B4F6C]/70" />
          </div>
          <div className="text-[17px] font-headline font-normal text-foreground/80">
            Session Recordings
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
          Top engaged pages by scroll depth, time on page, and clicks.
        </p>

        {/* Page engagement list */}
        <div className="flex-1 space-y-1.5 mb-3">
          {topPages.length > 0 ? (
            topPages.map((page, i) => (
              <a
                key={i}
                href={`https://clarity.microsoft.com/projects/view/${projectId}/dashboard`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors group"
              >
                <BarChart3 size={11} className="text-[#0B4F6C]/40 shrink-0" />
                <span className="text-[11px] text-foreground/70 truncate flex-1">
                  {page.page.replace(/^https?:\/\/[^/]+/, "") || "/"}
                </span>
                <span className="text-[10px] font-medium text-[#0B4F6C]/60 shrink-0">
                  {page.engagementScore}
                </span>
                <ExternalLink size={9} className="text-muted-foreground/30 group-hover:text-[#0B4F6C]/50 shrink-0" />
              </a>
            ))
          ) : (
            <div className="flex-1 flex items-center justify-center py-4">
              <p className="text-[10px] text-muted-foreground/50">No page data yet</p>
            </div>
          )}
        </div>

        <a
          href={topSessionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 text-[12px] font-medium rounded-lg bg-[#0B4F6C]/8 text-[#0B4F6C] hover:bg-[#0B4F6C]/15 transition-colors mt-auto"
        >
          View All in Clarity
          <ExternalLink size={11} />
        </a>
      </CardContent>
    </Card>
  );
}
