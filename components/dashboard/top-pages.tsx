"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverPanel } from "@/components/ui/hover-panel";
import { FileText, Loader2, Sparkles, Target } from "lucide-react";
import { normalizePath, type LabeledPage } from "@/lib/page-behavior";
import { keywordsForPage, targetsForPage, type RankedKeyword } from "@/lib/keyword-insights";
import { PageLabelPill } from "./page-label";
import { PositionPill } from "./keyword-detail";

interface PageRow {
  page: string;
  views: number;
  engagementScore?: number;
  avgDuration?: number;
}

interface TopPagesProps {
  data: PageRow[];
  labels?: LabeledPage[];
  keywords?: RankedKeyword[]; // SE Ranking tracked keywords, once loaded
  keywordsEnabled?: boolean; // SE Ranking is connected for this client
  clientSlug: string;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// Labels shown on this card. "Ignored" and "Low data" stay off: the first read
// as a judgment clients didn't find useful, the second tags most rows on a
// quiet week. Both still feed the Page behavior card's Fix first list.
const SHOWN_LABELS = new Set(["Strong", "Okay", "Leaking"]);

function SectionTitle({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1.5">
      {icon}
      {children}
    </div>
  );
}

// Session-wide cache so re-hovering a page doesn't refetch (the API also caches for a week),
// plus the in-flight request so a quick re-hover reuses it instead of firing another.
type AiSuggestion = { keyword: string; why: string };
const aiCache = new Map<string, AiSuggestion[]>();
const aiInFlight = new Map<string, Promise<AiSuggestion[] | null>>();

function AiSuggestions({ clientSlug, path, ranking, tracked }: {
  clientSlug: string;
  path: string;
  ranking: RankedKeyword[];
  tracked: string[];
}) {
  const key = `${clientSlug}|${path}`;
  const [items, setItems] = useState(aiCache.get(key) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (aiCache.has(key)) return;
    let cancelled = false;
    let request = aiInFlight.get(key);
    if (!request) {
      request = fetch("/api/keyword-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: clientSlug,
          page: path,
          ranking: ranking.map((k) => ({ keyword: k.keyword, position: k.position })),
          tracked,
        }),
      })
        .then((r) => r.json())
        .then((json) => {
          if (json.suggestions) aiCache.set(key, json.suggestions);
          return (json.suggestions as AiSuggestion[]) || null;
        })
        .catch(() => null)
        .finally(() => aiInFlight.delete(key));
      aiInFlight.set(key, request);
    }
    request.then((suggestions) => {
      if (cancelled) return;
      if (suggestions) setItems(suggestions);
      else setFailed(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (failed) return <p className="text-[13px] text-muted-foreground">Suggestions aren&apos;t available right now.</p>;
  if (!items) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Loader2 size={12} className="animate-spin" /> Thinking about this page…
      </p>
    );
  }
  if (items.length === 0) return <p className="text-[13px] text-muted-foreground">No new ideas for this page.</p>;
  return (
    <div className="space-y-2">
      {items.map((s) => (
        <div key={s.keyword}>
          <div className="text-[14px] font-medium text-foreground/90">{s.keyword}</div>
          <div className="text-[13px] leading-snug text-muted-foreground">{s.why}</div>
        </div>
      ))}
    </div>
  );
}

function PageDetail({ page, labeled, keywords, keywordsEnabled, clientSlug }: {
  page: PageRow;
  labeled?: LabeledPage;
  keywords?: RankedKeyword[];
  keywordsEnabled?: boolean;
  clientSlug: string;
}) {
  const path = normalizePath(page.page);
  const ranking = keywords ? keywordsForPage(path, keywords) : [];
  const targets = keywords ? targetsForPage(path, keywords) : [];
  const showLabel = labeled && SHOWN_LABELS.has(labeled.label);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[16px] font-semibold text-[#001A2E] break-all">{path === "/" ? "Home" : path}</span>
          {showLabel && <PageLabelPill label={labeled!.label} />}
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {page.views.toLocaleString()} views
          {page.avgDuration ? ` · ${formatDuration(page.avgDuration)} average time on page` : ""}
          {/* The label's reason already states engagement; repeat it here only when there's no label */}
          {!showLabel && page.engagementScore !== undefined ? ` · ${page.engagementScore}% of visits engage` : ""}
        </p>
        {showLabel && <p className="mt-1 text-[13px] text-foreground/75">{labeled!.reason}</p>}
      </div>

      {!keywordsEnabled ? (
        <p className="text-[13px] text-muted-foreground">Connect SE Ranking in Settings to see which keywords this page ranks for.</p>
      ) : !keywords ? (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Loading keyword data…
        </p>
      ) : (
        <>
          <div>
            <SectionTitle>Ranks in Google for</SectionTitle>
            {ranking.length > 0 ? (
              <div className="space-y-1.5">
                {ranking.slice(0, 6).map((k) => (
                  <div key={k.id} className="flex items-center gap-2">
                    <PositionPill position={k.position} />
                    <span className="flex-1 min-w-0 truncate text-[14px] text-foreground/90">{k.keyword}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {k.volume != null ? `${k.volume.toLocaleString()}/mo` : ""}
                    </span>
                  </div>
                ))}
                {ranking.length > 6 && (
                  <p className="text-[12px] text-muted-foreground">+{ranking.length - 6} more tracked keywords</p>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">None of the tracked keywords rank on this page yet.</p>
            )}
          </div>

          {targets.length > 0 && (
            <div>
              <SectionTitle icon={<Target size={11} />}>Tracked keywords to target here</SectionTitle>
              <div className="space-y-2">
                {targets.map(({ keyword: k, reason }) => (
                  <div key={k.id}>
                    <div className="flex items-baseline gap-2">
                      <span className="flex-1 min-w-0 text-[14px] font-medium text-foreground/90">{k.keyword}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {k.volume != null ? `${k.volume.toLocaleString()}/mo` : ""}
                      </span>
                    </div>
                    <div className="text-[13px] leading-snug text-muted-foreground">{reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionTitle icon={<Sparkles size={11} />}>New keyword ideas (AI)</SectionTitle>
            <AiSuggestions
              clientSlug={clientSlug}
              path={path}
              ranking={ranking}
              tracked={keywords.map((k) => k.keyword)}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function TopPages({ data, labels = [], keywords, keywordsEnabled, clientSlug }: TopPagesProps) {
  const max = Math.max(...data.map((d) => d.views), 1);
  const labelByPath = new Map(labels.map((l) => [l.path, l]));

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-[#097388]/75" />
          <CardTitle className="text-[22px] font-headline font-normal text-[#001A2E]">Top Pages</CardTitle>
          <span className="ml-auto text-[12px] text-[#097388]/65">Hover a page for keywords</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="space-y-1">
          {data.map((page) => {
            const labeled = labelByPath.get(normalizePath(page.page));
            return (
              <HoverPanel
                key={page.page}
                width={380}
                content={() => (
                  <PageDetail page={page} labeled={labeled} keywords={keywords} keywordsEnabled={keywordsEnabled} clientSlug={clientSlug} />
                )}
                className="px-2 py-2 -mx-2 cursor-default"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[15px] font-medium text-foreground/85 truncate flex-1" title={page.page}>
                    {page.page === "/" ? "Home" : page.page}
                  </span>
                  {labeled && SHOWN_LABELS.has(labeled.label) && <PageLabelPill label={labeled.label} />}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-[#001A2E]/50" style={{ width: `${(page.views / max) * 100}%` }} />
                  </div>
                  <span className="text-[14px] font-semibold tabular-nums text-[#001A2E] w-12 text-right">
                    {page.views.toLocaleString()}
                  </span>
                  {page.avgDuration !== undefined && page.avgDuration > 0 && (
                    <span className="text-[13px] text-muted-foreground tabular-nums w-14 whitespace-nowrap" title="Average time on page">
                      {formatDuration(page.avgDuration)}
                    </span>
                  )}
                </div>
              </HoverPanel>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
