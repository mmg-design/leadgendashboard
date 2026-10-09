"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Info } from "lucide-react";
import { groupSources } from "@/lib/source-colors";

interface SourceBarsProps {
  data: { source: string; sessions: number }[];
  // GA only returns the top 10 sources, so shares use the real session total when given.
  totalSessions?: number;
  title?: string;
}

const DESCRIPTIONS: Record<string, string> = {
  google: "People who clicked through from a Google search result.",
  direct: "People who typed your URL, used a bookmark, or came from an app that hides where they came from.",
  ai: "People who clicked a link in ChatGPT, Perplexity, Claude, Gemini, or Copilot.",
  linkedin: "People who clicked through from LinkedIn.",
  social: "People who clicked a link on Facebook, Instagram, YouTube, X, TikTok, Reddit, or Pinterest.",
  email: "People who clicked a link in an email campaign.",
  bing: "Visitors from Bing, Yahoo, or DuckDuckGo search results.",
  unknown: "Traffic where the source couldn't be determined. This often happens with some ad platforms.",
};

export function SourceBars({ data, totalSessions, title = "Traffic Sources" }: SourceBarsProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const groups = groupSources(data).slice(0, 8);
  const max = Math.max(...groups.map((g) => g.sessions), 1);
  const total = totalSessions || data.reduce((sum, d) => sum + d.sessions, 0) || 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[#097388]/75" />
          <CardTitle className="text-[22px] font-headline font-normal text-[#001A2E]">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {groups.map((g) => {
            const description =
              DESCRIPTIONS[g.key] ||
              `Visitors who came from ${g.label}. If you recognise it as a referral partner or ad platform, that's the source.`;
            return (
              <div
                key={g.key}
                className="relative"
                onMouseEnter={() => setHoveredKey(g.key)}
                onMouseLeave={() => setHoveredKey(null)}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="size-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                  <span className="text-[15px] font-medium text-foreground/85 flex items-center gap-1 min-w-0 truncate">
                    {g.label}
                    <Info size={11} className="text-[#097388]/50 shrink-0" />
                  </span>
                  <span className="ml-auto flex items-baseline gap-2 shrink-0 tabular-nums">
                    <span className="text-[15px] font-semibold text-[#001A2E]">{g.sessions.toLocaleString()}</span>
                    <span className="text-[13px] text-muted-foreground w-9 text-right">
                      {Math.round((g.sessions / total) * 100)}%
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full bg-[#001A2E]/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${(g.sessions / max) * 100}%`, background: g.color }}
                  />
                </div>

                {hoveredKey === g.key && (
                  <div className="absolute z-20 left-0 top-full mt-2 w-72 bg-white border border-border rounded-xl shadow-[0_8px_24px_rgba(0,26,46,0.12)] px-3.5 py-3 text-[13px] leading-relaxed text-foreground/75 pointer-events-none">
                    <span className="font-semibold text-[#001A2E]">{g.label}:</span> {description}
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
