"use client";

// The Keyword Map as a canvas: the site as a sitemap you can pan and zoom,
// with every target keyword on a panel to the left. Drag keywords between
// pages (3 a page), hover a page for its SEO hotspots, click it for the
// recommended changes, and send those to Agents. Changes stay a draft until
// Save; saving and sending both put a marker on the change timeline.

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  Background, ControlButton, Controls, Handle, MiniMap, NodeToolbar, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, CircleDashed, ExternalLink, EyeOff, House, Info, Link2, Loader2, Maximize2,
  Minimize2, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, Send, Star, Target, X,
} from "lucide-react";
import type { KeywordMap, PlanPage, PlanTerm, Priority } from "@/lib/keyword-map";
import type { PageDetails, PageDetailsResponse } from "@/lib/keyword-map-pages";
import {
  EMPTY_RECS, HOTSPOTS, applyRecEdits, checkHotspots, hotspotScore, hotspotText, ruleRecs, sortTerms, termsByPage,
  type Match, type Rec, type RecEdits,
} from "@/lib/keyword-plan";
import { NODE_W, buildCanvasTree, layoutTree } from "@/lib/keyword-canvas-layout";
import { reloadSiteEvents } from "@/components/dashboard/change-markers";
import { BAND, PRIORITY_STYLE, btnSecondary } from "@/components/dashboard/keyword-styles";

const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3 py-2 text-[14px] font-semibold text-white hover:bg-[#0394B2] disabled:opacity-50 transition-colors";
const NEXT_PRIORITY: Record<Priority, Priority> = { P1: "P2", P2: "P3", P3: "P1" };
const DETAIL_BATCH = 12;

type Snapshot = { terms: PlanTerm[]; recs: Record<string, RecEdits> };
const sig = (t: PlanTerm) => `${t.keyword}\u0000${t.page ?? ""}\u0000${t.priority}\u0000${t.primary ? 1 : 0}`;

// ── Shared state for the nodes ──────────────────────────────────────────────

interface Ctx {
  pages: Map<string, PlanPage>;
  byPage: Map<string, PlanTerm[]>;
  details: Record<string, PageDetails>;
  loadingUrls: Set<string>;
  maxPerPage: number;
  dragging: PlanTerm | null;
  dropTarget: string | null;
  selected: string | null;
  hovered: string | null;
  collapsed: Set<string>;
  setHovered: (id: string | null) => void;
  select: (id: string | null) => void;
  startDrag: (t: PlanTerm, e: DragEvent) => void;
  endDrag: () => void;
  dragOver: (pageKey: string | null, e: DragEvent) => void;
  drop: (pageKey: string | null, e: DragEvent) => void;
  expandMore: (parent: string) => void;
  toggleCollapse: (id: string) => void;
  recsFor: (pageKey: string) => Rec[];
}
const CanvasCtx = createContext<Ctx | null>(null);
const useCtx = () => useContext(CanvasCtx)!;

// ── Small pieces ────────────────────────────────────────────────────────────

function RankPill({ term }: { term: PlanTerm }) {
  const band = BAND[term.band];
  return (
    <span className={`inline-flex min-w-[40px] shrink-0 justify-center rounded-md border px-1 py-px text-[11.5px] font-semibold tabular-nums ${band.pill}`} title={term.tracked ? `Ranks ${term.position ? `#${term.position}` : "outside the top 100"}` : "Not tracked in SE Ranking"}>
      {term.position ? `#${term.position}` : term.tracked ? "–" : "?"}
    </span>
  );
}

function TermChip({ term, onPriority, onPrimary, onRemove, showPage, pageLabel }: {
  term: PlanTerm;
  onPriority?: () => void;
  onPrimary?: () => void;
  onRemove?: () => void;
  showPage?: boolean;
  pageLabel?: string;
}) {
  const { startDrag, endDrag, dragging } = useCtx();
  const isDragging = dragging?.keyword === term.keyword;
  const tip = [
    term.rankingPath ? `Google ranks ${term.rankingPath} for this` : null,
    term.volume ? `${term.volume.toLocaleString()} searches a month` : null,
    "Drag onto a page to assign it",
  ].filter(Boolean).join(" · ");
  return (
    <div
      draggable
      onDragStart={(e) => startDrag(term, e)}
      onDragEnd={endDrag}
      title={tip}
      className={`nodrag nopan group/chip flex min-w-0 cursor-grab items-center gap-1.5 rounded-lg border bg-white px-1.5 py-1 text-[13px] active:cursor-grabbing ${isDragging ? "border-[#0CA4C3] opacity-50" : "border-border hover:border-[#0CA4C3]/50"}`}
    >
      <RankPill term={term} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[#001A2E] ${term.primary ? "font-semibold" : ""}`}>{term.keyword}</span>
        {showPage && <span className="block truncate text-[11.5px] text-muted-foreground">{pageLabel || "Unassigned"}</span>}
      </span>
      {term.delta != null && term.delta !== 0 && (
        <span className={`inline-flex shrink-0 items-center text-[11px] font-medium tabular-nums ${term.delta > 0 ? "text-[#15803D]" : "text-[#B91C1C]"}`} title="Change over 7 days">
          {term.delta > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}{Math.abs(term.delta)}
        </span>
      )}
      {onPrimary ? (
        <button type="button" onClick={onPrimary} className="shrink-0 rounded p-0.5 hover:bg-muted" title={term.primary ? "Primary term for this page" : "Make this the page's primary term"} aria-label={term.primary ? "Primary term" : "Make primary"}>
          <Star size={12} className={term.primary ? "fill-[#F5B70A] text-[#F5B70A]" : "text-[#001A2E]/25"} />
        </button>
      ) : term.primary ? <Star size={12} className="shrink-0 fill-[#F5B70A] text-[#F5B70A]" aria-label="Primary term" /> : null}
      {onPriority ? (
        <button type="button" onClick={onPriority} className={`shrink-0 rounded px-1 py-px text-[10.5px] font-semibold tracking-wide ${PRIORITY_STYLE[term.priority]}`} title="Priority. Click to change.">{term.priority}</button>
      ) : (
        <span className={`shrink-0 rounded px-1 py-px text-[10.5px] font-semibold tracking-wide ${PRIORITY_STYLE[term.priority]}`}>{term.priority}</span>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-[#001A2E]" title="Take off this page" aria-label={`Take ${term.keyword} off this page`}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

const MATCH_STYLE: Record<Match, { cls: string; label: string; icon: ReactNode }> = {
  hit: { cls: "bg-[#DCFCE7] text-[#166534]", label: "Exact phrase", icon: <Check size={12} strokeWidth={3} /> },
  partial: { cls: "bg-[#FEF3C7] text-[#92400E]", label: "All the words, not as a phrase", icon: <span className="text-[12px] font-bold leading-none">~</span> },
  miss: { cls: "bg-[#FEE2E2] text-[#991B1B]", label: "Missing", icon: <X size={12} strokeWidth={3} /> },
};

function HotspotMatrix({ terms, details }: { terms: PlanTerm[]; details?: PageDetails }) {
  const h = details?.hotspots;
  return (
    <table className="w-full table-fixed text-[12.5px]">
      <colgroup><col /><col className="w-[44px]" /><col className="w-[44px]" /><col className="w-[44px]" /><col className="w-[44px]" /></colgroup>
      <thead>
        <tr className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          <th className="pb-1.5 text-left font-semibold">Keyword</th>
          {HOTSPOTS.map((s) => <th key={s.key} className="pb-1.5 text-center font-semibold" title={s.label}>{s.short}</th>)}
        </tr>
      </thead>
      <tbody>
        {terms.map((t) => {
          const c = checkHotspots(t.keyword, h);
          return (
            <tr key={t.keyword} className="border-t border-border/60">
              <td className="truncate py-1.5 pr-2 text-[#001A2E]" title={t.keyword}>
                {t.primary && <Star size={10} className="mr-1 inline fill-[#F5B70A] text-[#F5B70A]" />}{t.keyword}
              </td>
              {HOTSPOTS.map((s) => {
                const m = c?.[s.key];
                return (
                  <td key={s.key} className="py-1.5 text-center">
                    {m ? (
                      <span className={`inline-flex size-5 items-center justify-center rounded-md ${MATCH_STYLE[m].cls}`} title={`${s.label}: ${MATCH_STYLE[m].label}`}>{MATCH_STYLE[m].icon}</span>
                    ) : <span className="text-muted-foreground">–</span>}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function IndexBadge({ details, loading }: { details?: PageDetails; loading?: boolean }) {
  if (loading && !details) return <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground"><Loader2 size={11} className="animate-spin" /> Checking</span>;
  const idx = details?.index;
  if (!idx) return <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground" title="Index status needs Search Console access"><CircleDashed size={11} /> Index ?</span>;
  return idx.indexed ? (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#15803D]" title={`Google: ${idx.coverage}`}><Check size={12} strokeWidth={3} /> Indexed</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#B91C1C]" title={`Google: ${idx.coverage}`}><X size={12} strokeWidth={3} /> Not indexed</span>
  );
}

function LinksBadge({ details }: { details?: PageDetails }) {
  const l = details?.links;
  if (!l) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-[#365F6D]" title={l.note || "Other websites linking to this page, from the saved backlink report"}>
      <Link2 size={11} /> {l.refdomains != null ? `${l.refdomains} ${l.refdomains === 1 ? "site" : "sites"}` : "?"}
    </span>
  );
}

function ScoreBadge({ terms, details }: { terms: PlanTerm[]; details?: PageDetails }) {
  const s = hotspotScore(terms, details?.hotspots);
  if (!s) return null;
  const tone = s.hits === 4 ? "text-[#15803D]" : s.hits >= 2 ? "text-[#B45309]" : "text-[#B91C1C]";
  return (
    <span className={`inline-flex items-center gap-1 text-[11.5px] font-semibold tabular-nums ${tone}`} title="Hotspots (title, meta, H1, opening paragraph) with the primary term">
      <Target size={11} /> {s.hits}/{s.total}
    </span>
  );
}

// ── Nodes ───────────────────────────────────────────────────────────────────

const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

type NodeData = { id: string; kind: "page" | "folder" | "more"; hidden: number; hasChildren: boolean };

const PageNode = memo(function PageNode({ data }: NodeProps<Node<NodeData>>) {
  const ctx = useCtx();
  const page = ctx.pages.get(data.id) || null;
  const terms = ctx.byPage.get(data.id) || [];
  const details = page?.url ? ctx.details[page.url] : undefined;
  const loading = !!page?.url && ctx.loadingUrls.has(page.url);
  const folder = data.kind === "folder";
  const isTarget = ctx.dropTarget === data.id;
  const full = terms.length >= ctx.maxPerPage && !terms.some((t) => t.keyword === ctx.dragging?.keyword);
  const selected = ctx.selected === data.id;
  const recs = !folder && terms.length ? ctx.recsFor(data.id) : [];
  const label = page?.label || data.id;

  return (
    <div
      onDragOver={folder ? undefined : (e) => ctx.dragOver(data.id, e)}
      onDrop={folder ? undefined : (e) => ctx.drop(data.id, e)}
      style={{ width: NODE_W }}
      className={`rounded-xl border bg-white text-left transition-shadow ${folder ? "border-dashed border-border/80 bg-white/60" : "cursor-pointer"} ${page?.planned ? "border-dashed border-[#0CA4C3]/60 bg-[#F2FAFB]" : ""} ${
        isTarget ? (full ? "ring-2 ring-[#DC2626]" : "ring-2 ring-[#0CA4C3]") : selected ? "ring-2 ring-[#001A2E]" : ""
      } ${folder ? "" : "shadow-[0_1px_2px_rgba(0,26,46,0.05),0_4px_14px_rgba(0,26,46,0.05)] hover:shadow-[0_2px_4px_rgba(0,26,46,0.06),0_8px_24px_rgba(0,26,46,0.08)]"}`}
    >
      <Handle type="target" id="top" position={Position.Top} isConnectable={false} className={hiddenHandle} />
      <Handle type="target" id="left" position={Position.Left} isConnectable={false} className={hiddenHandle} style={{ top: 22 }} />
      <Handle type="source" id="bottom" position={Position.Bottom} isConnectable={false} className={hiddenHandle} />
      <Handle type="source" id="side" position={Position.Left} isConnectable={false} className={hiddenHandle} style={{ top: 22, left: 14 }} />

      <div className="flex items-start gap-1.5 px-3 pt-2.5">
        {data.hasChildren ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); ctx.toggleCollapse(data.id); }} className="nodrag nopan -ml-1 mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label={ctx.collapsed.has(data.id) ? `Expand ${label}` : `Collapse ${label}`}>
            {ctx.collapsed.has(data.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {page?.planned && <CircleDashed size={13} className="shrink-0 text-[#0394B2]" />}
            <span className="truncate text-[14px] font-semibold text-[#001A2E]" title={label}>{label}</span>
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground" title={page?.planned ? page.plannedNote || "" : data.id}>{page?.planned ? page.plannedNote : data.id}</div>
        </div>
        {!folder && (
          <span className={`shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums ${terms.length > ctx.maxPerPage ? "bg-[#FEE2E2] text-[#991B1B]" : terms.length === ctx.maxPerPage ? "bg-[#001A2E]/[0.07] text-[#001A2E]" : "bg-muted text-muted-foreground"}`} title={`${terms.length} of ${ctx.maxPerPage} target terms`}>
            {terms.length}/{ctx.maxPerPage}
          </span>
        )}
      </div>

      {folder ? (
        <div className="px-3 pb-2.5 pt-1 text-[11.5px] text-muted-foreground">Not a page on the site</div>
      ) : (
        <>
          {!page?.planned && (terms.length > 0 || details) && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 pt-1.5">
              <IndexBadge details={details} loading={loading} />
              <LinksBadge details={details} />
              <ScoreBadge terms={terms} details={details} />
            </div>
          )}
          <div className="space-y-1 px-2 pb-2 pt-2">
            {terms.length ? terms.map((t) => <TermChip key={t.keyword} term={t} />) : (
              <div className={`rounded-lg border border-dashed px-2 py-1.5 text-center text-[12px] ${isTarget ? "border-[#0CA4C3] text-[#0394B2]" : "border-border text-muted-foreground"}`}>Drop a keyword here</div>
            )}
          </div>
          {recs.length > 0 && (
            <div className="border-t border-border/60 px-3 py-1.5 text-[11.5px] font-medium text-[#0394B2]">{recs.length} recommended {recs.length === 1 ? "change" : "changes"}</div>
          )}
        </>
      )}

      {/* Hover card: the hotspots at a glance. Click the page for the full detail. */}
      {!folder && terms.length > 0 && !page?.planned && (
        <NodeToolbar isVisible={ctx.hovered === data.id && !selected && !ctx.dragging} position={Position.Right} offset={14} align="start">
          <div className="pointer-events-none w-[340px] rounded-xl border border-border bg-white p-3.5 text-left shadow-[0_8px_24px_rgba(0,26,46,0.12)]">
            <div className="text-[13.5px] font-semibold text-[#001A2E]">{label}</div>
            <div className="mb-2 truncate text-[11.5px] text-muted-foreground">{data.id}</div>
            {details?.hotspots?.ok ? (
              <>
                <HotspotMatrix terms={terms} details={details} />
                <dl className="mt-2.5 space-y-1 text-[12px]">
                  {HOTSPOTS.map((s) => (
                    <div key={s.key} className="flex gap-2">
                      <dt className="w-12 shrink-0 text-muted-foreground">{s.short}</dt>
                      <dd className="line-clamp-2 min-w-0 text-[#001A2E]/85">{hotspotText(details.hotspots!, s.key) || <span className="text-[#B91C1C]">None</span>}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : loading ? (
              <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Reading the live page…</p>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">{details?.hotspots && !details.hotspots.ok ? `The page didn't load${details.hotspots.status ? ` (status ${details.hotspots.status})` : ""}.` : "Not read yet."}</p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[12px]">
              <IndexBadge details={details} loading={loading} />
              <LinksBadge details={details} />
              {page && page.impressions > 0 && <span className="text-[11.5px] text-muted-foreground">{page.impressions.toLocaleString()} impressions (30d)</span>}
            </div>
            <p className="mt-1.5 text-[11.5px] text-[#0394B2]">Click for {recs.length ? `${recs.length} recommended changes` : "details"}</p>
          </div>
        </NodeToolbar>
      )}
    </div>
  );
});

const MoreNode = memo(function MoreNode({ data }: NodeProps<Node<NodeData>>) {
  const { expandMore } = useCtx();
  const parent = data.id.replace(/^more:/, "");
  return (
    <button type="button" onClick={() => expandMore(parent)} style={{ width: NODE_W }} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-white/70 text-[12.5px] font-medium text-muted-foreground hover:border-[#0CA4C3]/60 hover:text-[#0394B2]">
      <Handle type="target" id="top" position={Position.Top} isConnectable={false} className={hiddenHandle} />
      <Handle type="target" id="left" position={Position.Left} isConnectable={false} className={hiddenHandle} />
      <Plus size={13} /> {data.hidden} more {data.hidden === 1 ? "page" : "pages"}
    </button>
  );
});

const nodeTypes = { page: PageNode, folder: PageNode, more: MoreNode };

// ── Page drawer: detail, recommendations, send to Agents ───────────────────

function PageDrawer({ pageKey, terms, details, loading, recs, rules, recEdits, dirty, onClose, onEditRecs, onPriority, onPrimary, onRemove, onPush, pushState, onOpenAgents, onRefresh }: {
  pageKey: string;
  terms: PlanTerm[];
  details?: PageDetails;
  loading: boolean;
  recs: Rec[];
  rules: Rec[]; // before the team's edits, to show what a hidden one said
  recEdits: RecEdits;
  dirty: boolean;
  onClose: () => void;
  onEditRecs: (next: RecEdits) => void;
  onPriority: (t: PlanTerm) => void;
  onPrimary: (t: PlanTerm) => void;
  onRemove: (t: PlanTerm) => void;
  onPush: () => void;
  pushState: { busy: boolean; error: string | null; done: string | null };
  onOpenAgents?: () => void;
  onRefresh: () => void;
}) {
  const ctx = useCtx();
  const page = ctx.pages.get(pageKey);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [adding, setAdding] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const h = details?.hotspots;
  const dismissed = recEdits.dismissed;
  const label = page?.label || pageKey;

  const saveEdit = (r: Rec) => {
    const text = draftText.trim();
    if (r.custom) {
      const id = r.key.replace(/^custom:/, "");
      onEditRecs({ ...recEdits, custom: text ? recEdits.custom.map((c) => (c.id === id ? { ...c, text } : c)) : recEdits.custom.filter((c) => c.id !== id) });
    } else {
      const edits = { ...recEdits.edits };
      if (text) edits[r.key] = text; else delete edits[r.key];
      onEditRecs({ ...recEdits, edits });
    }
    setEditing(null);
  };
  const dismiss = (r: Rec) => {
    if (r.custom) onEditRecs({ ...recEdits, custom: recEdits.custom.filter((c) => `custom:${c.id}` !== r.key) });
    else onEditRecs({ ...recEdits, dismissed: [...new Set([...dismissed, r.key])] });
  };
  const reset = (r: Rec) => {
    const edits = { ...recEdits.edits };
    delete edits[r.key];
    onEditRecs({ ...recEdits, edits });
  };
  const add = () => {
    const text = adding.trim();
    if (!text) return;
    onEditRecs({ ...recEdits, custom: [...recEdits.custom, { id: Math.random().toString(36).slice(2, 10), text }] });
    setAdding("");
  };

  return (
    <div className="nodrag nopan nowheel flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-[0_8px_32px_rgba(0,26,46,0.14)]">
      <div className="flex items-start gap-2 border-b border-border/70 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold text-[#001A2E]" title={label}>{label}</div>
          {page?.url ? (
            <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#0394B2]">
              <span className="truncate">{page.path}</span> <ExternalLink size={11} className="shrink-0" />
            </a>
          ) : <div className="text-[12.5px] text-[#0394B2]">{page?.plannedNote || "Planned page"}</div>}
        </div>
        {page?.url && (
          <button type="button" onClick={onRefresh} disabled={loading} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40" title="Read the live page again">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close"><X size={15} /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {!page?.planned && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted/50 px-2 py-2"><div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Google</div><div className="mt-0.5 flex justify-center"><IndexBadge details={details} loading={loading} /></div></div>
            <div className="rounded-lg bg-muted/50 px-2 py-2"><div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Backlinks</div><div className="mt-0.5 flex justify-center"><LinksBadge details={details} /></div></div>
            <div className="rounded-lg bg-muted/50 px-2 py-2"><div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Hotspots</div><div className="mt-0.5 flex justify-center">{hotspotScore(terms, h) ? <ScoreBadge terms={terms} details={details} /> : <span className="text-[11.5px] text-muted-foreground">–</span>}</div></div>
          </div>
        )}
        {details?.index && !details.index.indexed && (
          <p className="rounded-lg bg-[#FEE2E2]/60 px-3 py-2 text-[12.5px] text-[#7F1D1D]">Google: “{details.index.coverage}”. {details.index.reason}{" "}
            <a href={details.index.inspectUrl} target="_blank" rel="noreferrer" className="font-medium underline">Open in Search Console</a>
          </p>
        )}

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Target keywords</h4>
            <span className="text-[12px] text-muted-foreground">{terms.length} of {ctx.maxPerPage}</span>
          </div>
          <div className="space-y-1">
            {terms.map((t) => <TermChip key={t.keyword} term={t} onPriority={() => onPriority(t)} onPrimary={() => onPrimary(t)} onRemove={() => onRemove(t)} />)}
            {!terms.length && <p className="text-[13px] text-muted-foreground">Drag a keyword from the panel onto this page.</p>}
          </div>
        </section>

        {!page?.planned && terms.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">SEO hotspots</h4>
            {h?.ok ? (
              <>
                <HotspotMatrix terms={terms} details={details} />
                <dl className="mt-3 space-y-2 text-[12.5px]">
                  {HOTSPOTS.map((s) => (
                    <div key={s.key}>
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{s.label}</dt>
                      <dd className="mt-0.5 text-[#001A2E]/85">{hotspotText(h, s.key) || <span className="text-[#B91C1C]">None found</span>}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : loading ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Reading the live page…</p>
            ) : (
              <p className="text-[13px] text-muted-foreground">{h ? `The page didn't load${h.status ? ` (status ${h.status})` : ""}.` : "Not read yet."}</p>
            )}
          </section>
        )}

        {terms.length > 0 && (
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Recommended changes</h4>
              {dismissed.length > 0 && (
                <button type="button" onClick={() => setShowDismissed(!showDismissed)} className="text-[12px] text-muted-foreground hover:text-[#001A2E]">{showDismissed ? "Hide" : "Show"} {dismissed.length} hidden</button>
              )}
            </div>
            <ol className="space-y-1.5">
              {recs.map((r, i) => (
                <li key={r.key} className="group/rec rounded-lg border border-border/70 px-2.5 py-2 text-[13px] leading-snug text-[#001A2E]">
                  {editing === r.key ? (
                    <div>
                      <textarea autoFocus value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={3} className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/30" />
                      <div className="mt-1.5 flex gap-1.5">
                        <button type="button" onClick={() => saveEdit(r)} className="rounded-md bg-[#001A2E] px-2 py-1 text-[12px] font-medium text-white">Done</button>
                        <button type="button" onClick={() => setEditing(null)} className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:text-[#001A2E]">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <span className="mt-px w-4 shrink-0 text-right text-[12px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        {r.text}
                        {(r.edited || r.custom) && <span className="ml-1.5 rounded bg-[#0CA4C3]/10 px-1 py-px text-[10.5px] font-medium text-[#01384C]">{r.custom ? "Added" : "Edited"}</span>}
                      </span>
                      <span className="flex shrink-0 gap-0.5 opacity-60 group-hover/rec:opacity-100">
                        <button type="button" onClick={() => { setEditing(r.key); setDraftText(r.text); }} className="rounded p-0.5 hover:bg-muted" title="Edit" aria-label="Edit recommendation"><Pencil size={12} /></button>
                        {r.edited && <button type="button" onClick={() => reset(r)} className="rounded p-0.5 hover:bg-muted" title="Back to the original wording" aria-label="Reset"><RotateCcw size={12} /></button>}
                        <button type="button" onClick={() => dismiss(r)} className="rounded p-0.5 hover:bg-muted" title={r.custom ? "Delete" : "Hide this one"} aria-label="Remove recommendation">{r.custom ? <X size={12} /> : <EyeOff size={12} />}</button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
              {!recs.length && <li className="text-[13px] text-muted-foreground">{loading ? "Waiting for the live page…" : "Nothing to change. The page already features its terms."}</li>}
            </ol>
            {showDismissed && dismissed.length > 0 && (
              <ul className="mt-2 space-y-1">
                {dismissed.map((k) => (
                  <li key={k} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1 text-[12px] text-muted-foreground">
                    <span className="min-w-0 truncate" title={rules.find((r) => r.key === k)?.text}>{rules.find((r) => r.key === k)?.text || "No longer applies"}</span>
                    <button type="button" onClick={() => onEditRecs({ ...recEdits, dismissed: dismissed.filter((d) => d !== k) })} className="shrink-0 font-medium text-[#0394B2] hover:underline">Restore</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-1.5">
              <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add your own recommendation" className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/30" />
              <button type="button" onClick={add} disabled={!adding.trim()} className={btnSecondary.replace("px-3 py-2", "px-2.5 py-1.5")}><Plus size={13} /> Add</button>
            </div>
          </section>
        )}
      </div>

      {terms.length > 0 && (
        <div className="border-t border-border/70 px-4 py-3">
          {pushState.error && <p className="mb-2 text-[12.5px] text-red-600">{pushState.error}</p>}
          {pushState.done ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-[#15803D]"><Check size={13} className="mr-1 inline" />{pushState.done}</p>
              {onOpenAgents && <button type="button" onClick={onOpenAgents} className="text-[13px] font-medium text-[#0394B2] hover:underline">Open Agents</button>}
            </div>
          ) : (
            <>
              <button type="button" onClick={onPush} disabled={dirty || pushState.busy || !recs.length} className={`${btnPrimary} w-full justify-center`}>
                {pushState.busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to Agents
              </button>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                {dirty ? "Save your changes first, so Agents works from the saved plan." : "Adds a task with these changes. Nothing is drafted or charged until someone runs it in Agents."}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Keyword panel ───────────────────────────────────────────────────────────

function KeywordPanel({ terms, pages, maxPerPage, onPriority, onFocusPage }: {
  terms: PlanTerm[];
  pages: Map<string, PlanPage>;
  maxPerPage: number;
  onPriority: (t: PlanTerm) => void;
  onFocusPage: (key: string) => void;
}) {
  const ctx = useCtx();
  const [query, setQuery] = useState("");
  const [showTracked, setShowTracked] = useState(20);
  const qn = query.trim().toLowerCase();
  const visible = qn ? terms.filter((t) => t.keyword.toLowerCase().includes(qn)) : terms;
  const groups = new Map<string, PlanTerm[]>();
  for (const t of visible) if (t.page) groups.set(t.page, [...(groups.get(t.page) || []), t]);
  const ordered = [...groups.entries()]
    .map(([k, list]) => [k, sortTerms(list)] as const)
    .sort((a, b) => (a[0] === "/" ? -1 : b[0] === "/" ? 1 : 0) || ({ P1: 0, P2: 1, P3: 2 }[a[1][0].priority] - { P1: 0, P2: 1, P3: 2 }[b[1][0].priority]) || a[0].localeCompare(b[0]));
  const unassigned = visible.filter((t) => !t.page);
  const parked = unassigned.filter((t) => t.origin !== "tracked");
  const tracked = unassigned.filter((t) => t.origin === "tracked");
  const assignedCount = terms.filter((t) => t.page).length;
  const isTarget = ctx.dropTarget === "__panel";

  return (
    <div className="nowheel flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-white">
      <div className="border-b border-border/70 px-3.5 py-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-semibold text-[#001A2E]">Target keywords</h3>
          <span className="text-[12px] text-muted-foreground">{assignedCount} on pages</span>
        </div>
        <div className="relative mt-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a keyword" className="w-full rounded-lg border border-border py-1.5 pl-7 pr-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/30" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {ordered.map(([key, list]) => {
          const page = pages.get(key);
          const all = ctx.byPage.get(key) || [];
          return (
            <div key={key}>
              <button type="button" onClick={() => onFocusPage(key)} className="mb-1 flex w-full items-center justify-between gap-2 text-left" title="Show on the canvas">
                <span className="min-w-0 truncate text-[12.5px] font-semibold text-[#001A2E] hover:text-[#0394B2]">{page?.label || key}</span>
                <span className={`shrink-0 text-[11px] tabular-nums ${all.length > maxPerPage ? "font-semibold text-[#B91C1C]" : "text-muted-foreground"}`}>{all.length}/{maxPerPage}</span>
              </button>
              <div className="space-y-1">{list.map((t) => <TermChip key={t.keyword} term={t} onPriority={() => onPriority(t)} />)}</div>
            </div>
          );
        })}

        <div
          onDragOver={(e) => ctx.dragOver(null, e)}
          onDrop={(e) => ctx.drop(null, e)}
          className={`rounded-xl border border-dashed p-2 ${isTarget ? "border-[#0CA4C3] bg-[#F2FAFB]" : "border-border"}`}
        >
          <div className="mb-1.5 px-0.5 text-[12.5px] font-semibold text-[#001A2E]">Not on a page</div>
          <p className="mb-2 px-0.5 text-[11.5px] leading-snug text-muted-foreground">Drop a keyword here to take it off its page. Drag one onto a page to target it.</p>
          <div className="space-y-1">
            {parked.map((t) => <TermChip key={t.keyword} term={t} onPriority={() => onPriority(t)} />)}
            {tracked.length > 0 && (
              <>
                <div className="px-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Tracked in SE Ranking</div>
                {tracked.slice(0, showTracked).map((t) => <TermChip key={t.keyword} term={t} onPriority={() => onPriority(t)} />)}
                {tracked.length > showTracked && (
                  <button type="button" onClick={() => setShowTracked((n) => n + 40)} className="w-full py-1 text-[12px] font-medium text-[#0394B2] hover:underline">Show {Math.min(40, tracked.length - showTracked)} more of {tracked.length - showTracked}</button>
                )}
              </>
            )}
            {!parked.length && !tracked.length && <p className="px-0.5 text-[12px] text-muted-foreground">{qn ? "No matches." : "Every keyword is on a page."}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Canvas ──────────────────────────────────────────────────────────────────

export interface KeywordCanvasProps {
  clientSlug: string;
  map: KeywordMap;
  onSaved: () => void;
  onOpenAgents?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function KeywordCanvas(props: KeywordCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ clientSlug, map, onSaved, onOpenAgents, onDirtyChange }: KeywordCanvasProps) {
  const plan = map.plan;
  const flow = useReactFlow();
  const initial = useMemo<Snapshot>(() => ({ terms: [...plan.terms, ...plan.candidates], recs: plan.recs || {} }), [plan]);
  const [terms, setTerms] = useState<PlanTerm[]>(initial.terms);
  const [recs, setRecs] = useState<Record<string, RecEdits>>(initial.recs);
  const [version, setVersion] = useState(plan.version);
  useEffect(() => { setTerms(initial.terms); setRecs(initial.recs); setVersion(plan.version); }, [initial, plan.version]);

  const pages = useMemo(() => new Map(plan.pages.map((p) => [p.key, p])), [plan.pages]);
  const byPage = useMemo(() => termsByPage(terms), [terms]);

  // Draft vs saved.
  const changes = useMemo(() => {
    const was = new Map(initial.terms.map((t) => [t.keyword, t]));
    let moved = 0, edited = 0;
    for (const t of terms) {
      const o = was.get(t.keyword);
      if (!o) continue;
      if (o.page !== t.page) moved++;
      else if (sig(o) !== sig(t)) edited++;
    }
    const recPages = new Set([...Object.keys(recs), ...Object.keys(initial.recs)].filter((k) => JSON.stringify(recs[k] || EMPTY_RECS) !== JSON.stringify(initial.recs[k] || EMPTY_RECS)));
    return { moved, edited, recPages: recPages.size };
  }, [terms, recs, initial]);
  const dirty = changes.moved + changes.edited + changes.recPages > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── Page details (hotspots, index, links) ──
  const [details, setDetails] = useState<Record<string, PageDetails>>({});
  const [loadingUrls, setLoadingUrls] = useState<Set<string>>(new Set());
  const requested = useRef(new Set<string>());
  const [detailNote, setDetailNote] = useState<string | null>(null);
  const loadDetails = useCallback(async (urls: string[], fresh = false) => {
    const want = urls.filter((u) => fresh || !requested.current.has(u));
    if (!want.length) return;
    want.forEach((u) => requested.current.add(u));
    setLoadingUrls((s) => new Set([...s, ...want]));
    const batches: string[][] = [];
    for (let i = 0; i < want.length; i += DETAIL_BATCH) batches.push(want.slice(i, i + DETAIL_BATCH));
    await Promise.all(batches.map(async (batch) => {
      try {
        const r = (await fetch("/api/keyword-map/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: clientSlug, urls: batch, fresh }) }).then((res) => res.json())) as PageDetailsResponse & { error?: string };
        if (r.error) throw new Error(r.error);
        setDetails((d) => ({ ...d, ...r.pages }));
        if (r.index.status === "not_configured") setDetailNote("Search Console isn't connected, so index status can't be checked.");
        else if (r.index.status === "error") setDetailNote(r.index.message || "Couldn't check index status for every page.");
      } catch {
        batch.forEach((u) => requested.current.delete(u));
        setDetailNote("Couldn't read some pages. Hover or open them to try again.");
      } finally {
        setLoadingUrls((s) => { const n = new Set(s); batch.forEach((u) => n.delete(u)); return n; });
      }
    }));
  }, [clientSlug]);
  // Every page with target terms, now and whenever one gains a term.
  useEffect(() => {
    const urls = [...byPage.keys()].map((k) => pages.get(k)?.url).filter((u): u is string => !!u);
    loadDetails(urls);
  }, [byPage, pages, loadDetails]);

  // ── Tree and layout ──
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Real card heights from the canvas. The cache only takes new positive
  // heights, so a re-layout (which hands React Flow fresh nodes it hasn't
  // measured yet) can't start a measure, re-layout, measure loop.
  const heightsCache = useRef(new Map<string, number>());
  const heightsKey = useStore((st) => {
    const parts: string[] = [];
    st.nodeLookup.forEach((n, id) => { const h = Math.round(n.measured?.height ?? 0); if (h > 0) parts.push(`${id}\u0001${h}`); });
    return parts.sort().join("\u0002");
  });
  const [heightsVersion, setHeightsVersion] = useState(0);
  useEffect(() => {
    let changed = false;
    for (const part of heightsKey ? heightsKey.split("\u0002") : []) {
      const [id, h] = part.split("\u0001");
      if (heightsCache.current.get(id) !== Number(h)) { heightsCache.current.set(id, Number(h)); changed = true; }
    }
    if (changed) setHeightsVersion((v) => v + 1);
  }, [heightsKey]);
  const measured = useMemo(() => new Map(heightsCache.current), [heightsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const { nodes, edges } = useMemo(() => {
    const tree = buildCanvasTree(plan.pages, byPage, expanded, collapsed);
    const childCount = new Map<string, number>();
    const walk = (n: typeof tree) => { childCount.set(n.id, n.children.filter((c) => c.kind !== "more").length + (collapsed.has(n.id) && n.hidden ? 1 : 0)); n.children.forEach(walk); };
    walk(tree);
    const hiddenOf = new Map<string, number>();
    const walk2 = (n: typeof tree) => { if (n.kind === "more") hiddenOf.set(n.id, n.hidden); n.children.forEach(walk2); };
    walk2(tree);
    const placed = layoutTree(tree, byPage, measured);
    const nodes: Node<NodeData>[] = placed.map((p) => ({
      id: p.id,
      type: p.kind,
      position: { x: p.x, y: p.y },
      // Known sizes up front, so React Flow doesn't hide the card while it measures it again.
      ...(measured.get(p.id) ? { measured: { width: NODE_W, height: measured.get(p.id)! } } : {}),
      data: { id: p.id, kind: p.kind, hidden: hiddenOf.get(p.id) || 0, hasChildren: (childCount.get(p.id) || 0) > 0 || collapsed.has(p.id) },
      draggable: false,
      selectable: false,
    }));
    const edges: Edge[] = placed.filter((p) => p.parent).map((p) => ({
      id: `${p.parent}->${p.id}`,
      source: p.parent!,
      target: p.id,
      sourceHandle: p.stacked ? "side" : "bottom",
      targetHandle: p.stacked ? "left" : "top",
      type: p.stacked ? "step" : "smoothstep",
      style: { stroke: "rgba(0,26,46,0.22)", strokeWidth: 1.25 },
    }));
    return { nodes, edges };
  }, [plan.pages, byPage, expanded, collapsed, measured]);
  const placedById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // ── Drag and drop ──
  const [dragging, setDragging] = useState<PlanTerm | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3800); return () => clearTimeout(t); }, [toast]);

  const moveTerm = useCallback((keyword: string, to: string | null) => {
    setTerms((list) => {
      const term = list.find((t) => t.keyword === keyword);
      if (!term || term.page === to) return list;
      if (to) {
        const count = list.filter((t) => t.page === to && t.keyword !== keyword).length;
        if (count >= plan.maxPerPage) {
          setToast({ text: `${pages.get(to)?.label || to} already targets ${plan.maxPerPage} keywords. Move one off first.`, tone: "error" });
          return list;
        }
      }
      return list.map((t) => (t.keyword === keyword ? { ...t, page: to, primary: false } : t));
    });
  }, [plan.maxPerPage, pages]);

  // ── Selection, hover ──
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const recsFor = useCallback((key: string) => {
    const page = pages.get(key);
    const list = byPage.get(key) || [];
    if (!page || !list.length) return [];
    return applyRecEdits(ruleRecs(page, list, page.url ? details[page.url] : undefined, plan.maxPerPage), recs[key]);
  }, [pages, byPage, details, recs, plan.maxPerPage]);
  const ctxValue: Ctx = {
    pages, byPage, details, loadingUrls, maxPerPage: plan.maxPerPage, dragging, dropTarget,
    selected, hovered, collapsed, setHovered, select: setSelected,
    startDrag: (t, e) => { e.dataTransfer.setData("text/plain", t.keyword); e.dataTransfer.effectAllowed = "move"; setDragging(t); },
    endDrag: () => { setDragging(null); setDropTarget(null); },
    dragOver: (key, e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const target = key ?? "__panel";
      if (dropTarget !== target) setDropTarget(target);
      // A full page still accepts the drop, so it can say why it's refused.
      e.dataTransfer.dropEffect = "move";
    },
    drop: (key, e) => {
      e.preventDefault();
      e.stopPropagation();
      const keyword = e.dataTransfer.getData("text/plain") || dragging?.keyword;
      if (keyword) moveTerm(keyword, key);
      setDragging(null);
      setDropTarget(null);
    },
    expandMore: (parent) => setExpanded((s) => new Set([...s, parent])),
    toggleCollapse: (id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    recsFor,
  };

  useEffect(() => {
    const url = (selected && pages.get(selected)?.url) || (hovered && pages.get(hovered)?.url);
    if (url) loadDetails([url]);
  }, [selected, hovered, pages, loadDetails]);

  const focusPage = useCallback((key: string) => {
    // A page under a "+N more" stub: open its parents' hidden pages first.
    if (!placedById.has(key) && key.startsWith("/")) {
      const parts = key.split("/").filter(Boolean);
      const parents = parts.map((_, i) => (i === 0 ? "/" : `/${parts.slice(0, i).join("/")}`));
      setExpanded((s) => new Set([...s, ...parents]));
      setCollapsed((s) => { const n = new Set(s); parents.forEach((p) => n.delete(p)); return n; });
    }
    setSelected(key);
    requestAnimationFrame(() => {
      const n = flow.getNode(key);
      if (n) flow.setCenter(n.position.x + NODE_W / 2 + 160, n.position.y + 80, { zoom: Math.max(flow.getZoom(), 0.9), duration: 450 });
    });
  }, [flow, placedById]);

  // ── Edits from the drawer and panel ──
  const cyclePriority = (t: PlanTerm) => setTerms((list) => list.map((x) => (x.keyword === t.keyword ? { ...x, priority: NEXT_PRIORITY[x.priority] } : x)));
  const makePrimary = (t: PlanTerm) => setTerms((list) => list.map((x) => (x.page === t.page ? { ...x, primary: x.keyword === t.keyword ? !x.primary : false } : x)));

  // ── Save ──
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const assigned = terms.filter((t) => t.page);
      const parked = terms.filter((t) => !t.page && (t.origin !== "tracked" || t.priority !== "P3"));
      const res = await fetch("/api/keyword-map", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: clientSlug,
          version,
          terms: assigned.map((t) => ({ keyword: t.keyword, page: t.page, priority: t.priority, primary: t.primary })),
          parked: parked.map((t) => ({ keyword: t.keyword, priority: t.priority })),
          recs,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save.");
      setVersion(body.version);
      setToast({ text: body.changes ? "Saved. The change is on the timeline." : "Saved.", tone: "ok" });
      reloadSiteEvents(clientSlug);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };
  const discard = () => { setTerms(initial.terms); setRecs(initial.recs); setSaveError(null); };

  // ── Push ──
  const [push, setPush] = useState<{ page: string | null; busy: boolean; error: string | null; done: string | null }>({ page: null, busy: false, error: null, done: null });
  useEffect(() => { setPush({ page: null, busy: false, error: null, done: null }); }, [selected]);
  const sendToAgents = async () => {
    if (!selected) return;
    const list = byPage.get(selected) || [];
    setPush({ page: selected, busy: true, error: null, done: null });
    try {
      const res = await fetch("/api/keyword-map/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug, page: selected, recommendations: recsFor(selected).map((r) => r.text), positions: Object.fromEntries(list.map((t) => [t.keyword, t.position])) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't send it.");
      setPush({ page: selected, busy: false, error: null, done: body.status === "drafted" ? "Updated the task. Its earlier draft is kept." : "Sent. It's in Agents, under Search." });
      reloadSiteEvents(clientSlug);
    } catch (err) {
      setPush({ page: selected, busy: false, error: err instanceof Error ? err.message : "Couldn't send it.", done: null });
    }
  };

  // ── Full screen ──
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  // Opening view: the homepage centered at the top at a readable zoom. A
  // small site fits whole; a big one starts at the top of the tree.
  const paneRef = useRef<HTMLDivElement>(null);
  const resetView = useCallback((duration = 0) => {
    const el = paneRef.current;
    const root = flow.getNode("/");
    if (!el || !root) return;
    const xs = nodes.map((n) => n.position.x);
    const width = Math.max(...xs) + NODE_W - Math.min(...xs);
    const zoom = Math.min(1, Math.max(0.72, (el.clientWidth - 48) / width));
    flow.setViewport({ x: el.clientWidth / 2 - (root.position.x + NODE_W / 2) * zoom, y: 28, zoom }, { duration });
  }, [flow, nodes]);
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || !nodes.length) return;
    viewed.current = true;
    requestAnimationFrame(() => resetView());
  }, [nodes, resetView]);
  useEffect(() => { const t = setTimeout(() => resetView(250), 60); return () => clearTimeout(t); }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTerms = selected ? byPage.get(selected) || [] : [];
  const selectedPage = selected ? pages.get(selected) : undefined;
  const changeText = [
    changes.moved && `${changes.moved} ${changes.moved === 1 ? "keyword" : "keywords"} moved`,
    changes.edited && `${changes.edited} priority or primary ${changes.edited === 1 ? "change" : "changes"}`,
    changes.recPages && `recommendations edited on ${changes.recPages} ${changes.recPages === 1 ? "page" : "pages"}`,
  ].filter(Boolean).join(", ");

  return (
    <CanvasCtx.Provider value={ctxValue}>
      <div className={full ? "fixed inset-0 z-[70] flex flex-col gap-3 bg-[#F4F7F8] p-3" : "flex h-[calc(100vh-160px)] min-h-[640px] flex-col gap-3"}>
        <div className="flex min-h-[40px] flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span className="inline-flex cursor-help items-center gap-1 font-medium text-[#001A2E]" title={`Hover a page for its SEO hotspots. Click it for recommended changes and to send them to Agents. Drag keywords between pages, ${plan.maxPerPage} a page. Scroll to pan, pinch or use the buttons to zoom.`}>
              <Info size={13} /> How it works
            </span>
            <span className="inline-flex items-center gap-2">
              {(["top3", "top10", "top20", "top50", "low", "none"] as const).map((b) => (
                <span key={b} className="inline-flex items-center gap-1"><span className={`size-2 rounded-full ${BAND[b].dot}`} />{BAND[b].label}</span>
              ))}
            </span>
            <span className="inline-flex items-center gap-1"><Star size={11} className="fill-[#F5B70A] text-[#F5B70A]" /> primary</span>
            <span className="inline-flex items-center gap-1"><Target size={11} /> hotspots with the primary term</span>
            {detailNote && <span className="text-[#B45309]">{detailNote}</span>}
          </div>
          <div className="flex items-center gap-2">
            {dirty ? (
              <>
                <span className="text-[12.5px] text-[#001A2E]"><span className="font-semibold">Unsaved:</span> {changeText}</span>
                <button type="button" onClick={discard} disabled={saving} className={btnSecondary}>Discard</button>
                <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                </button>
              </>
            ) : (
              <span className="text-[12.5px] text-muted-foreground">All changes saved</span>
            )}
            <button type="button" onClick={() => setFull(!full)} className={btnSecondary} title={full ? "Exit full screen (Esc)" : "Full screen"} aria-label={full ? "Exit full screen" : "Full screen"}>
              {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
        {saveError && <p className="-mt-1 text-right text-[13px] text-red-600">{saveError}</p>}

        <div className="flex min-h-0 flex-1 gap-3">
          <div className="w-[232px] shrink-0 xl:w-[272px]">
            <KeywordPanel terms={terms} pages={pages} maxPerPage={plan.maxPerPage} onPriority={cyclePriority} onFocusPage={focusPage} />
          </div>
          <div ref={paneRef} className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border bg-[#F7F9FA]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              minZoom={0.15}
              maxZoom={1.75}
              panOnScroll
              zoomOnScroll={false}
              zoomOnPinch
              zoomOnDoubleClick={false}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              onPaneClick={() => setSelected(null)}
              // Node-level handlers also switch the nodes' pointer events on,
              // which React Flow turns off for non-draggable, non-selectable nodes.
              onNodeMouseEnter={(_, n) => setHovered(n.id)}
              onNodeMouseLeave={() => setHovered(null)}
              onNodeClick={(_, n) => { if (n.type === "page") setSelected((s) => (s === n.id ? null : n.id)); }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={22} size={1.2} color="rgba(0,26,46,0.12)" />
              <Controls showInteractive={false} position="bottom-left">
                <ControlButton onClick={() => resetView(300)} title="Back to the homepage" aria-label="Back to the homepage"><House size={14} /></ControlButton>
              </Controls>
              <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => ((byPage.get(n.id)?.length || 0) > 0 ? "#0CA4C3" : "#cbd5e1")} maskColor="rgba(244,247,248,0.7)" style={{ width: 160, height: 110 }} />
            </ReactFlow>

            {toast && (
              <div className={`pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-lg px-3 py-2 text-[13px] font-medium shadow-lg ${toast.tone === "error" ? "bg-[#7F1D1D] text-white" : "bg-[#001A2E] text-white"}`}>{toast.text}</div>
            )}

            {selected && selectedPage && (
              <div className="absolute bottom-3 right-3 top-3 z-10 w-[380px] max-w-[calc(100%-24px)]">
                <PageDrawer
                  key={selected}
                  pageKey={selected}
                  terms={selectedTerms}
                  details={selectedPage.url ? details[selectedPage.url] : undefined}
                  loading={!!selectedPage.url && loadingUrls.has(selectedPage.url)}
                  recs={recsFor(selected)}
                  rules={ruleRecs(selectedPage, selectedTerms, selectedPage.url ? details[selectedPage.url] : undefined, plan.maxPerPage)}
                  recEdits={recs[selected] || EMPTY_RECS}
                  dirty={dirty}
                  onClose={() => setSelected(null)}
                  onEditRecs={(next) => setRecs((r) => ({ ...r, [selected]: next }))}
                  onPriority={cyclePriority}
                  onPrimary={makePrimary}
                  onRemove={(t) => moveTerm(t.keyword, null)}
                  onPush={sendToAgents}
                  pushState={push.page === selected ? push : { busy: false, error: null, done: null }}
                  onOpenAgents={onOpenAgents}
                  onRefresh={() => selectedPage.url && loadDetails([selectedPage.url], true)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </CanvasCtx.Provider>
  );
}
