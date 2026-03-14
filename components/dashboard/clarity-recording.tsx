"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Video, ExternalLink } from "lucide-react";

interface ClarityRecordingProps {
  topSessionUrl: string;
  projectId: string;
}

export function ClarityRecordingLink({ topSessionUrl, projectId }: ClarityRecordingProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardContent className="py-4 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-2 rounded-lg bg-[#0B4F6C]/8">
              <Video size={16} className="text-[#0B4F6C]/70" />
            </div>
            <div className="text-[13px] font-medium text-foreground/80">
              Session Recordings
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
            Watch real visitor sessions to see how people navigate the site, where they get stuck, and what catches their attention.
          </p>
        </div>
        <a
          href={topSessionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 text-[12px] font-medium rounded-lg bg-[#0B4F6C]/8 text-[#0B4F6C] hover:bg-[#0B4F6C]/15 transition-colors"
        >
          Watch Top Session
          <ExternalLink size={11} />
        </a>
      </CardContent>
    </Card>
  );
}
