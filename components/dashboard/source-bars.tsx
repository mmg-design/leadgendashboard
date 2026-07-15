"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Info } from "lucide-react";

interface SourceBarsProps {
  data: { source: string; sessions: number }[];
  title?: string;
}

const SOURCE_LABELS: Record<string, { label: string; description: string }> = {
  google: { label: "Google", description: "People who clicked through from a Google search result." },
  "(direct)": { label: "Direct", description: "People who typed your URL directly into their browser or used a bookmark." },
  direct: { label: "Direct", description: "People who typed your URL directly into their browser or used a bookmark." },
  "(none)": { label: "Direct", description: "People who typed your URL directly into their browser or used a bookmark." },
  bing: { label: "Bing", description: "Visitors from Microsoft Bing search results." },
  yahoo: { label: "Yahoo", description: "Visitors from Yahoo search results." },
  facebook: { label: "Facebook", description: "People who clicked a link on Facebook." },
  instagram: { label: "Instagram", description: "People who came from an Instagram post or bio link." },
  linkedin: { label: "LinkedIn", description: "People who clicked through from LinkedIn." },
  twitter: { label: "Twitter / X", description: "Visitors from Twitter or X posts." },
  youtube: { label: "YouTube", description: "People who clicked a link in a YouTube video description." },
  email: { label: "Email", description: "People who clicked a link in an email campaign." },
  "(not set)": { label: "Unknown", description: "Traffic where the source couldn't be determined - often happens with some ad platforms." },
};

function getSourceMeta(rawSource: string) {
  const lower = rawSource.toLowerCase();
  for (const [key, meta] of Object.entries(SOURCE_LABELS)) {
    if (lower === key || lower.includes(key)) return { ...meta, raw: rawSource };
  }
  const label = rawSource.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    label,
    description: `Visitors who came from ${label}. If you recognise this as a referral partner or ad platform, that's the source.`,
    raw: rawSource,
  };
}

export function SourceBars({ data, title = "Traffic Sources" }: SourceBarsProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.sessions), 1);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe size={15} className="text-[#097388]/75" />
          <CardTitle className="text-[22px] font-headline font-normal text-[#001A2E]">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {data.slice(0, 8).map((item, i) => {
            const meta = getSourceMeta(item.source);
            const pct = Math.round((item.sessions / max) * 100);
            const isHovered = hoveredIndex === i;
            return (
              <div
                key={i}
                className="relative group"
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px] font-medium text-foreground/80 flex items-center gap-1 min-w-0">
                    {meta.label}
                    <Info size={10} className="text-[#097388]/55 shrink-0" />
                  </span>
                  <span className="text-[13px] text-muted-foreground ml-auto tabular-nums shrink-0">
                    {item.sessions.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#001A2E] rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {/* Tooltip */}
                {isHovered && (
                  <div className="absolute z-20 left-0 top-full mt-1.5 w-64 bg-white border border-border/60 rounded-lg shadow-lg px-3 py-2.5 text-[13px] leading-relaxed text-foreground/70 pointer-events-none">
                    <span className="font-semibold text-foreground/90">{meta.label}:</span>{" "}
                    {meta.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
