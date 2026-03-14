"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Video, ExternalLink } from "lucide-react";

interface ClarityRecordingProps {
  topSessionUrl: string;
  projectId: string;
}

export function ClarityRecordingLink({ topSessionUrl, projectId }: ClarityRecordingProps) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#0B4F6C]/8">
              <Video size={16} className="text-[#0B4F6C]/70" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-foreground/80">
                Session Recordings
              </div>
              <div className="text-[11px] text-muted-foreground">
                Watch the most engaged visitor sessions via Clarity
              </div>
            </div>
          </div>
          <a
            href={topSessionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[#0B4F6C]/8 text-[#0B4F6C] hover:bg-[#0B4F6C]/15 transition-colors"
          >
            Watch Top Session
            <ExternalLink size={11} />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
