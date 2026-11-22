// Positions for the Keyword Map canvas: the homepage on top, each URL level a
// row below, like a sitemap. A page whose children are all leaf pages stacks
// them in a column under it (as sitemap tools do), so a blog with 40 posts is
// a tall column instead of a row 10,000px wide. Pure, so it's easy to check.

import type { PlanPage, PlanTerm } from "./keyword-map";

export const NODE_W = 248;
const GAP_X = 40;
const GAP_Y = 64;
const GAP_STACK = 14;
const STACK_INDENT = 28;
const STACK_MIN = 3; // fewer leaf children than this sit in a row
export const SHOW_MIN_IMPRESSIONS = 50; // pages with no terms show only with real search traffic

export type CanvasNodeKind = "page" | "folder" | "more";

export interface TreeNode {
  id: string; // page key, or "more:<parent>" for a hidden-pages stub
  kind: CanvasNodeKind;
  path: string;
  page: PlanPage | null;
  children: TreeNode[];
  hidden: number; // hidden pages under this node, shown as a "+N more" stub
}

export interface Placed {
  id: string;
  kind: CanvasNodeKind;
  x: number;
  y: number;
  h: number;
  parent: string | null;
  stacked: boolean; // placed in a parent's column (edge leaves from the side)
}

const segs = (p: string) => p.split("/").filter(Boolean);
const parentOf = (p: string) => (segs(p).length <= 1 ? "/" : `/${segs(p).slice(0, -1).join("/")}`);
const labelOf = (p: string) => {
  const s = segs(p).pop() || "Home";
  const w = s.replace(/[-_]+/g, " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
};

// Card heights, matching the page card's layout closely enough for spacing.
export function nodeHeight(kind: CanvasNodeKind, terms: number): number {
  if (kind === "more") return 40;
  if (kind === "folder") return 52;
  return 92 + Math.max(1, terms) * 26;
}

export function buildCanvasTree(
  pages: PlanPage[],
  byPage: Map<string, PlanTerm[]>,
  expanded: Set<string>, // parents whose hidden pages are shown
  collapsed: Set<string>, // nodes whose children are folded away
): TreeNode {
  const real = new Map(pages.filter((p) => !p.planned).map((p) => [p.path, p]));
  const nodes = new Map<string, TreeNode>();
  const ensure = (path: string): TreeNode => {
    const found = nodes.get(path);
    if (found) return found;
    const page = real.get(path) || null;
    const node: TreeNode = { id: path, kind: page ? "page" : "folder", path, page: page || (path === "/" ? null : null), children: [], hidden: 0 };
    if (!page && path !== "/") node.page = { key: path, path, label: labelOf(path), url: null, planned: false, plannedNote: null, inSitemap: false, impressions: 0, clicks: 0, alsoRanks: [] };
    nodes.set(path, node);
    if (path !== "/") ensure(parentOf(path)).children.push(node);
    return node;
  };
  const root = ensure("/");
  if (!root.page) root.page = { key: "/", path: "/", label: "Home", url: null, planned: false, plannedNote: null, inSitemap: false, impressions: 0, clicks: 0, alsoRanks: [] };
  for (const path of real.keys()) ensure(path);

  const terms = (n: TreeNode) => byPage.get(n.id)?.length || 0;
  const interesting = (n: TreeNode) => terms(n) > 0 || (n.page?.impressions ?? 0) >= SHOW_MIN_IMPRESSIONS || (n.page?.alsoRanks[0]?.impressions ?? 0) >= SHOW_MIN_IMPRESSIONS;
  const bestPriority = (n: TreeNode): number => Math.min(3, ...(byPage.get(n.id) || []).map((t) => ({ P1: 0, P2: 1, P3: 2 })[t.priority]), ...n.children.map(bestPriority));
  const count = (n: TreeNode): number => 1 + n.children.reduce((s, c) => s + count(c), 0);

  // Keep a node when it (or anything under it) has terms or traffic, or its
  // parent's hidden pages were opened. The rest become "+N more".
  const prune = (n: TreeNode): boolean => {
    const open = expanded.has(n.id);
    const kept: TreeNode[] = [];
    for (const c of n.children) {
      const keep = prune(c);
      if (keep || open) kept.push(c);
      else n.hidden += count(c);
    }
    kept.sort((a, b) => bestPriority(a) - bestPriority(b) || Number(terms(b) > 0) - Number(terms(a) > 0) || (a.page?.label || "").localeCompare(b.page?.label || ""));
    n.children = kept;
    return n === root || interesting(n) || kept.length > 0;
  };
  prune(root);

  const fold = (n: TreeNode) => {
    if (collapsed.has(n.id)) { n.hidden += n.children.reduce((s, c) => s + count(c), 0); n.children = []; return; }
    n.children.forEach(fold);
    if (n.hidden > 0 && !collapsed.has(n.id)) n.children.push({ id: `more:${n.id}`, kind: "more", path: n.path, page: null, children: [], hidden: n.hidden });
  };
  fold(root);

  // Planned pages hang off the homepage, after the real ones.
  for (const p of pages.filter((x) => x.planned)) root.children.push({ id: p.key, kind: "page", path: p.key, page: p, children: [], hidden: 0 });
  return root;
}

// `measured` holds each card's real rendered height once the canvas has drawn
// it; until then the estimate is used.
export function layoutTree(root: TreeNode, byPage: Map<string, PlanTerm[]>, measured?: Map<string, number>): Placed[] {
  const h = (n: TreeNode) => measured?.get(n.id) || nodeHeight(n.kind, byPage.get(n.id)?.length || 0);
  const stacks = (n: TreeNode) => n.children.length >= STACK_MIN && n.children.every((c) => c.children.length === 0);
  const sizes = new Map<string, { w: number; h: number }>();
  const measure = (n: TreeNode): { w: number; h: number } => {
    let size: { w: number; h: number };
    if (!n.children.length) size = { w: NODE_W, h: h(n) };
    else if (stacks(n)) size = { w: NODE_W + STACK_INDENT, h: h(n) + GAP_Y / 2 + n.children.reduce((s, c) => s + h(c) + GAP_STACK, 0) };
    else {
      const kids = n.children.map(measure);
      size = { w: Math.max(NODE_W, kids.reduce((s, k) => s + k.w, 0) + GAP_X * (kids.length - 1)), h: h(n) + GAP_Y + Math.max(...kids.map((k) => k.h)) };
    }
    sizes.set(n.id, size);
    return size;
  };
  measure(root);

  const out: Placed[] = [];
  const place = (n: TreeNode, left: number, top: number, parent: string | null, stacked: boolean) => {
    const size = sizes.get(n.id) || { w: NODE_W, h: h(n) };
    const nodeX = stacked || stacks(n) ? left : left + (size.w - NODE_W) / 2;
    out.push({ id: n.id, kind: n.kind, x: nodeX, y: top, h: h(n), parent, stacked });
    if (!n.children.length) return;
    if (stacks(n)) {
      let y = top + h(n) + GAP_Y / 2;
      for (const c of n.children) {
        place(c, left + STACK_INDENT, y, n.id, true);
        y += h(c) + GAP_STACK;
      }
      return;
    }
    let x = left;
    for (const c of n.children) {
      place(c, x, top + h(n) + GAP_Y, n.id, false);
      x += (sizes.get(c.id)?.w || NODE_W) + GAP_X;
    }
  };
  place(root, 0, 0, null, false);
  return out;
}
