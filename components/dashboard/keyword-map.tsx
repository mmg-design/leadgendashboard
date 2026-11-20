"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleDashed, ExternalLink, FilePlus2,
  GitFork, Globe, Info, Loader2, RefreshCw, Search, Star, TrendingDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import type { FlagType, KeywordMap, MapFlag, MapNode, MapTerm, Priority, RankBand } from "@/lib/keyword-map";

const btnSecondary = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[14px] font-medium text-[#001A2E] hover:bg-muted/50 disabled:opacity-50 transition-colors";

// Color shows ranking only; priority is its own tag.
const BAND: Record<RankBand, { label: string; pill: string; dot: string }> = {
  top3: { label: "1–3", pill: "bg-[#DCFCE7] text-[#166534] border-[#86EFAC]", dot: "bg-[#16A34A]" },
  top10: { label: "4–10", pill: "bg-[#ECFCCB] text-[#3F6212] border-[#BEF264]", dot: "bg-[#65A30D]" },
  top20: { label: "11–20", pill: "bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]", dot: "bg-[#D97706]" },
  top50: { label: "21–50", pill: "bg-[#FFEDD5] text-[#9A3412] border-[#FDBA74]", dot: "bg-[#EA580C]" },
  low: { label: "51–100", pill: "bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]", dot: "bg-[#DC2626]" },
  none: { label: "Not ranking", pill: "bg-[#FEE2E2]/60 text-[#991B1B] border-[#FECACA]", dot: "bg-[#FCA5A5]" },
};

const PRIORITY_STYLE: Record<Priority, string> = {
  P1: "bg-[#001A2E] text-white",
  P2: "bg-[#0CA4C3]/15 text-[#01384C]",
  P3: "bg-muted text-muted-foreground",
};

const FLAG_META: Record<FlagType, { label: string; icon: typeof AlertTriangle; tone: string }> = {
  slipping: { label: "Slipping", icon: TrendingDown, tone: "text-[#B91C1C]" },
  wrong_page: { label: "Wrong page ranks", icon: AlertTriangle, tone: "text-[#B45309]" },
  other_site: { label: "Another site ranks", icon: Globe, tone: "text-[#B45309]" },
  competing: { label: "Pages compete", icon: GitFork, tone: "text-[#B45309]" },
  missing_page: { label: "Page needed", icon: FilePlus2, tone: "text-[#0394B2]" },
  off_plan: { label: "Off plan", icon: Search, tone: "text-[#365F6D]" },
};

function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function TermRow({ term, targetPath }: { term: MapTerm; targetPath: string }) {
  const band = BAND[term.band];
  const issue = term.flags.filter((f) => f !== "missing_page");
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-1.5">
      <span className={`inline-flex min-w-[52px] justify-center rounded-md border px-1.5 py-0.5 text-[12.5px] font-semibold tabular-nums ${band.pill}`} title={term.tracked ? `Rank band ${band.label}` : "Not tracked in SE Ranking yet"}>
        {term.position ? `#${term.position}` : "–"}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[14.5px] text-[#001A2E]">
        {term.primary && <Star size={13} className="shrink-0 fill-[#F5B70A] text-[#F5B70A]" aria-label="Primary term" />}
        <span className={term.primary ? "font-semibold" : ""}>{term.keyword}</span>
      </span>
      <span className={`rounded px-1.5 py-px text-[11px] font-semibold tracking-wide ${PRIORITY_STYLE[term.priority]}`}>{term.priority}</span>
      {term.delta != null && term.delta !== 0 && (
        <span className={`inline-flex items-center text-[12.5px] font-medium tabular-nums ${term.delta > 0 ? "text-[#15803D]" : "text-[#B91C1C]"}`} title="Change over 7 days">
          {term.delta > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(term.delta)}
        </span>
      )}
      {term.volume != null && term.volume > 0 && <span className="text-[12.5px] text-muted-foreground tabular-nums">{term.volume.toLocaleString()}/mo</span>}
      {issue.map((f) => {
        const meta = FLAG_META[f];
        const Icon = meta.icon;
        const note = f === "wrong_page" ? `${term.rankingPath} ranks instead of ${targetPath}` : f === "other_site" ? "Another website ranks instead" : meta.label;
        return (
          <span key={f} className={`inline-flex items-center gap-1 text-[12.5px] font-medium ${meta.tone}`}>
            <Icon size={12} /> {note}
          </span>
        );
      })}
    </div>
  );
}

function PageCard({ node }: { node: MapNode }) {
  const page = node.page!;
  return (
    <div className={`rounded-xl border bg-white px-4 py-3 ${page.planned ? "border-dashed border-[#0CA4C3]/50 bg-[#F2FAFB]" : "border-border shadow-[0_1px_2px_rgba(0,26,46,0.04)]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {page.planned && <CircleDashed size={15} className="shrink-0 text-[#0394B2]" />}
          <span className="text-[15px] font-semibold text-[#001A2E]">{page.label}</span>
          {page.url ? (
            <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-[13px] text-muted-foreground hover:text-[#0394B2]">
              {page.path} <ExternalLink size={11} />
            </a>
          ) : (
            <span className="rounded bg-[#0CA4C3]/10 px-1.5 py-px text-[11.5px] font-medium text-[#01384C]">{page.plannedNote}</span>
          )}
        </div>
        {page.impressions > 0 && (
          <span className="text-[12.5px] text-muted-foreground tabular-nums">{page.impressions.toLocaleString()} impressions · {page.clicks.toLocaleString()} clicks (30d)</span>
        )}
      </div>
      {page.terms.length > 0 && (
        <div className="mt-1.5 divide-y divide-border/60">
          {page.terms.map((t) => <TermRow key={t.keyword} term={t} targetPath={page.path} />)}
        </div>
      )}
      {page.alsoRanks.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <span className="font-medium">Also ranks for:</span>
          {page.alsoRanks.map((q) => (
            <span key={q.query} className="rounded-full bg-muted/70 px-2 py-0.5" title={`${q.impressions} impressions, ${q.clicks} clicks, average position ${q.position.toFixed(1)} (30d)`}>
              {q.query} <span className="tabular-nums opacity-70">~#{Math.round(q.position)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const hasTerms = (n: MapNode): boolean => !!n.page?.terms.length || n.children.some(hasTerms);

function TreeNode({ node, depth }: { node: MapNode; depth: number }) {
  // Branches with target terms start open; traffic-only branches start closed.
  const [open, setOpen] = useState(depth === 0 || node.children.some(hasTerms));
  const hasChildren = node.children.length > 0;
  const showCard = !!node.page && (node.page.terms.length > 0 || node.page.alsoRanks.length > 0 || node.page.planned);
  return (
    <div>
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`mt-2.5 rounded p-0.5 text-muted-foreground hover:bg-muted ${hasChildren ? "" : "invisible"}`}
          aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div className="min-w-0 flex-1">
          {showCard ? (
            <PageCard node={node} />
          ) : (
            <div className="flex items-center gap-2 py-2 text-[14px] font-semibold text-[#001A2E]">
              {node.label} <span className="font-normal text-muted-foreground">{node.path}</span>
            </div>
          )}
        </div>
      </div>
      {open && (hasChildren || node.hiddenCount > 0) && (
        <div className="ml-[11px] mt-2 space-y-2 border-l border-border pl-4">
          {node.children.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
          {node.hiddenCount > 0 && (
            <p className="py-1 text-[12.5px] text-muted-foreground">
              + {node.hiddenCount} {node.hiddenCount === 1 ? "page" : "pages"} with no target terms or meaningful search traffic
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FlagItem({ flag }: { flag: MapFlag }) {
  const meta = FLAG_META[flag.type];
  const Icon = meta.icon;
  return (
    <li className="flex gap-2.5 py-3">
      <Icon size={16} className={`mt-0.5 shrink-0 ${meta.tone}`} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {flag.priority && <span className={`rounded px-1.5 py-px text-[11px] font-semibold ${PRIORITY_STYLE[flag.priority]}`}>{flag.priority}</span>}
          <span className="text-[14px] font-semibold leading-snug text-[#001A2E]">{flag.title}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{flag.detail}</p>
      </div>
    </li>
  );
}

export function KeywordMapTab({ clientSlug, clientName }: { clientSlug: string; clientName: string }) {
  const [map, setMap] = useState<KeywordMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllFlags, setShowAllFlags] = useState(false);

  async function load(fresh = false) {
    try {
      const r = await fetch(`/api/keyword-map?client=${clientSlug}${fresh ? "&fresh=1" : ""}`).then((res) => res.json());
      if (r.error) setError(r.error);
      else { setMap(r); setError(null); }
    } catch {
      setError("Couldn't load the keyword map. Try again in a minute.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }
  useEffect(() => { setLoading(true); load(); }, [clientSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const flagCounts = useMemo(() => {
    const out: Partial<Record<FlagType, number>> = {};
    for (const f of map?.flags || []) out[f.type] = (out[f.type] || 0) + 1;
    return out;
  }, [map]);

  if (loading) {
    return (
      <Card><CardContent className="flex items-center justify-center gap-2 py-12 text-[15px] text-muted-foreground">
        <Loader2 size={17} className="animate-spin" /> Building the keyword map from SE Ranking, Search Console and the sitemap…
      </CardContent></Card>
    );
  }

  if (error || !map) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-[#0CA4C3]/25 bg-[#F2FAFB] px-5 py-4 text-[14.5px] text-[#001A2E]">
        <Info size={18} className="mt-0.5 shrink-0 text-[#0394B2]" />
        <div>
          <p className="font-semibold">{error === "no_core_set" ? "No core keyword set yet" : "The keyword map isn't available"}</p>
          <p className="mt-0.5 text-[#001A2E]/75">
            {error === "no_core_set"
              ? `${clientName} doesn't have an approved set of target keywords saved. Once one is approved, it shows here on the site's page tree.`
              : error}
          </p>
        </div>
      </div>
    );
  }

  const s = map.summary;
  const flags = showAllFlags ? map.flags : map.flags.slice(0, 8);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1">
        <div>
          <div className="mb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0394B2]">Keyword Map</div>
          <h2 className="font-headline text-[28px] text-[#001A2E]">Target keywords for {clientName}</h2>
          <p className="mt-1 max-w-[760px] text-[15px] text-muted-foreground">
            Each page's target terms on the site's page tree. Color shows how well a term ranks; P1 to P3 shows how much it matters to the business. Team only.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-muted-foreground" title="Rankings refresh hourly, Search Console every 6 hours, the sitemap daily">
            {refreshing ? "Refreshing…" : `Updated ${timeAgo(map.generatedAt)}`}
          </span>
          <button className={btnSecondary} disabled={refreshing} onClick={() => { setRefreshing(true); load(true); }} title="Free: reads SE Ranking, Search Console and the sitemap again">
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {(!map.sources.seRanking || !map.sources.searchConsole) && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-[#78350F]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            {!map.sources.seRanking && "SE Ranking isn't connected for this client, so rankings are blank. "}
            {!map.sources.searchConsole && "Search Console isn't connected, so \"also ranks for\", competing pages and off-plan terms can't be checked."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="In the top 3" value={`${s.top3} / ${s.total}`} subtitle="target terms ranking 1–3" tooltip="Core terms where the site ranks in Google's top three, from SE Ranking." />
        <StatCard title="On page one" value={`${s.top10} / ${s.total}`} subtitle={`${s.notRanking} not in the top 100 yet`} tooltip="Core terms ranking in the top 10, which is page one of Google." />
        <StatCard title="P1 terms on page one" value={`${s.p1Top10} / ${s.p1Total}`} subtitle="the terms that matter most" tooltip="Priority 1 terms are core revenue services. This is the number to move first." />
        <StatCard title="Problems to fix" value={s.flags} subtitle={Object.entries(flagCounts).map(([k, v]) => `${v} ${FLAG_META[k as FlagType].label.toLowerCase()}`).slice(0, 2).join(" · ") || "nothing flagged"} tooltip="Wrong pages ranking, pages competing, slipping P1 terms, pages to create, and off-plan terms. Listed on the right." />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[12.5px] text-muted-foreground">
        <span className="font-medium text-[#001A2E]">Rank</span>
        {(Object.keys(BAND) as RankBand[]).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${BAND[b].dot}`} /> {BAND[b].label}</span>
        ))}
        <span className="ml-2 inline-flex items-center gap-1.5"><Star size={12} className="fill-[#F5B70A] text-[#F5B70A]" /> primary term</span>
        <span className="inline-flex items-center gap-1.5"><CircleDashed size={12} className="text-[#0394B2]" /> planned page</span>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <Card className="overflow-visible">
          <CardContent>
            <TreeNode node={map.tree} depth={0} />
          </CardContent>
        </Card>

        <Card className="xl:sticky xl:top-6">
          <CardContent>
            <h3 className="text-[17px] font-semibold text-[#001A2E]">Action map</h3>
            <p className="mt-0.5 text-[14px] text-muted-foreground">What to fix, most important first.</p>
            {map.flags.length === 0 ? (
              <p className="mt-4 text-[14px] text-muted-foreground">Nothing flagged. Every target term ranks on its own page.</p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-border/70">{flags.map((f, i) => <FlagItem key={`${f.type}-${f.keyword}-${f.page}-${i}`} flag={f} />)}</ul>
                {map.flags.length > 8 && (
                  <button className="mt-2 text-[13.5px] font-medium text-[#0394B2] hover:underline" onClick={() => setShowAllFlags((v) => !v)}>
                    {showAllFlags ? "Show fewer" : `Show all ${map.flags.length}`}
                  </button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
