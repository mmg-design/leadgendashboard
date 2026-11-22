// The Keyword Map's planning rules, shared by the canvas (which reruns them as
// terms are dragged between pages) and the server (which checks a save).
// Plain functions, no I/O.

import type { PlanPage, PlanTerm, Priority } from "./keyword-map";
import type { PageDetails, PageHotspots } from "./keyword-map-pages";

// ── Hotspot matching ────────────────────────────────────────────────────────
// Hit: the exact phrase. Partial: every meaningful word, but not as a phrase
// ("IOP for teens in Columbus" for "teen iop columbus"). Case, punctuation and
// simple plurals are ignored; nothing looser, so every call is defensible.

export type Match = "hit" | "partial" | "miss";
export type Hotspot = "title" | "meta" | "h1" | "intro";
export const HOTSPOTS: { key: Hotspot; label: string; short: string }[] = [
  { key: "title", label: "Title tag", short: "Title" },
  { key: "meta", label: "Meta description", short: "Meta" },
  { key: "h1", label: "H1", short: "H1" },
  { key: "intro", label: "Opening paragraph", short: "Intro" },
];

const STOP = new Set(["a", "an", "the", "for", "in", "of", "to", "and", "with", "on", "at", "by", "near", "me", "my", "best"]);

function singular(w: string) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
  return w;
}

export function words(s: string): string[] {
  return s.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map(singular);
}

// "near me" is how people search, not how pages are written, so it's left out
// of the phrase a page is expected to contain.
function termWords(term: string) {
  const w = words(term);
  const i = w.findIndex((x, j) => x === "near" && w[j + 1] === "me");
  return i >= 0 && w.length > 2 ? [...w.slice(0, i), ...w.slice(i + 2)] : w;
}

export function match(term: string, text: string): Match {
  const t = termWords(term);
  const x = words(text);
  if (!t.length || !x.length) return "miss";
  for (let i = 0; i + t.length <= x.length; i++) {
    if (t.every((w, j) => x[i + j] === w)) return "hit";
  }
  const have = new Set(x);
  const core = t.filter((w) => !STOP.has(w));
  return core.length && core.every((w) => have.has(w)) ? "partial" : "miss";
}

export function hotspotText(h: PageHotspots, spot: Hotspot): string {
  return spot === "title" ? h.title : spot === "meta" ? h.metaDescription : spot === "h1" ? h.h1.join(" · ") : h.intro;
}

export function checkHotspots(term: string, h: PageHotspots | null | undefined): Record<Hotspot, Match> | null {
  if (!h?.ok) return null;
  return {
    title: match(term, h.title),
    meta: match(term, h.metaDescription),
    h1: match(term, h.h1.join(" ")),
    intro: match(term, h.intro),
  };
}

// ── Assignments ─────────────────────────────────────────────────────────────

export const PRIORITY_RANK: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };

export function sortTerms(terms: PlanTerm[]) {
  return [...terms].sort((a, b) => Number(b.primary) - Number(a.primary) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.position ?? 999) - (b.position ?? 999));
}

export function termsByPage(terms: PlanTerm[]): Map<string, PlanTerm[]> {
  const out = new Map<string, PlanTerm[]>();
  for (const t of terms) {
    if (!t.page) continue;
    const list = out.get(t.page) || [];
    list.push(t);
    out.set(t.page, list);
  }
  for (const [k, list] of out) out.set(k, sortTerms(list));
  return out;
}

// The term a page is built around: the one marked primary, else the top one.
export function primaryOf(terms: PlanTerm[]): PlanTerm | null {
  return terms.find((t) => t.primary) || sortTerms(terms)[0] || null;
}

// ── Recommendations ─────────────────────────────────────────────────────────
// Rule-based and free: what to change on the page so it can rank for the terms
// assigned to it. Agents does the actual drafting, only when someone runs it.

export interface Rec {
  key: string; // stable across reloads, so edits and dismissals stick
  text: string;
  edited?: boolean;
  custom?: boolean;
}

export interface RecEdits {
  edits: Record<string, string>;
  dismissed: string[];
  custom: { id: string; text: string }[];
}

export const EMPTY_RECS: RecEdits = { edits: {}, dismissed: [], custom: [] };

const q = (s: string) => `“${s}”`;
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function ruleRecs(page: PlanPage, terms: PlanTerm[], details: PageDetails | undefined, maxPerPage: number): Rec[] {
  if (!terms.length) return [];
  const sorted = sortTerms(terms);
  const primary = primaryOf(sorted)!;
  const recs: Rec[] = [];
  const add = (key: string, text: string) => recs.push({ key, text });

  if (terms.length > maxPerPage) add("limit", `This page targets ${terms.length} terms. Keep it to ${maxPerPage} so each one can be featured.`);

  if (page.planned) {
    add("create", `Create this page. It's planned for ${sorted.map((t) => q(t.keyword)).join(", ")}, with ${q(primary.keyword)} in the title, H1 and opening paragraph.`);
    return recs;
  }

  const h = details?.hotspots;
  const idx = details?.index;
  if (idx && !idx.indexed) add("index", `Get this page indexed first. Google reports ${q(idx.coverage)}.${idx.reason ? ` ${idx.reason}` : ""}`);
  if (h?.noindex) add("noindex", "Remove the noindex tag. The page tells Google not to index it, so nothing else here can help until it's gone.");
  if (h && !h.ok) add("load", `The live page didn't load${h.status ? ` (status ${h.status})` : ""}, so its title, H1 and copy couldn't be checked.`);

  if (h?.ok) {
    const p = primary.keyword;
    const c = checkHotspots(p, h)!;
    if (!h.title) add(`title:${p}`, `Add a title tag that leads with ${q(p)}.`);
    else if (c.title !== "hit") add(`title:${p}`, `${c.title === "partial" ? "Use the exact phrase" : "Put"} ${q(p)} in the title tag, near the start. Now: ${q(clip(h.title))}.`);
    if (!h.h1.length) add(`h1:${p}`, `Add one H1 that includes ${q(p)}.`);
    else if (c.h1 !== "hit") add(`h1:${p}`, `Work ${q(p)} into the H1. Now: ${q(clip(h.h1[0]))}.`);
    if (!h.intro) add(`intro:${p}`, `Add an opening paragraph under the H1 that mentions ${q(p)} in its first sentence.`);
    else if (c.intro !== "hit") add(`intro:${p}`, `Mention ${q(p)} in the opening paragraph, ideally in the first sentence.`);
    if (!h.metaDescription) add(`meta:${p}`, `Write a meta description that includes ${q(p)}. Without one, Google writes its own snippet.`);
    else if (c.meta !== "hit") add(`meta:${p}`, `Include ${q(p)} in the meta description. Google bolds the words that match the search.`);

    for (const t of sorted) {
      if (t === primary) continue;
      const s = checkHotspots(t.keyword, h)!;
      if (!Object.values(s).includes("hit")) add(`cover:${t.keyword}`, `Work ${q(t.keyword)} into the meta description or opening paragraph, or give it its own H2.`);
    }
  }

  for (const t of sorted) {
    const k = t.keyword;
    if (t.rankingPath && t.position && t.rankingPath !== page.path) {
      add(`wrong:${k}`, `Google ranks ${t.rankingPath} for ${q(k)} (#${t.position}), not this page. Move the term there, or link from ${t.rankingPath} to this page with ${q(k)} as the anchor text.`);
    }
    const others = t.competingPaths.filter((x) => x !== page.path);
    if (others.length && t.competingPaths.length >= 2) {
      add(`compete:${k}`, `${others.length === 1 ? "Another page splits" : `${others.length} other pages split`} Google's impressions for ${q(k)} (${others.slice(0, 3).join(", ")}). Make this page the clear match and link to it from ${others.length === 1 ? "that page" : "them"}.`);
    }
    if (!t.tracked) add(`track:${k}`, `${q(k)} isn't tracked in SE Ranking, so its ranking can't be measured. Add it to the SE Ranking project.`);
    else if (!t.position) add(`rank:${k}`, `${q(k)} isn't in the top 100 yet. Give it a dedicated section on this page and link here from related pages.`);
    else if (t.position > 3 && t.position <= 20) add(`push:${k}`, `Ranks #${t.position} for ${q(k)}, within reach of the top 3. Add depth the page is missing (an FAQ, a section on the specifics) and 2–3 internal links pointing here.`);
    if (t.delta != null && t.delta <= -3) add(`slip:${k}`, `${q(k)} dropped ${-t.delta} positions this week. Check for recent edits to this page or a competitor's new page.`);
  }

  const weak = sorted.some((t) => t.priority !== "P3" && (!t.position || t.position > 10));
  if (details?.links.refdomains === 0 && weak) add("links", `No other sites link to this page yet. One or two relevant links would help it compete for ${q(primary.keyword)}.`);

  return recs;
}

export function applyRecEdits(rules: Rec[], e: RecEdits | undefined): Rec[] {
  if (!e) return rules;
  const out = rules
    .filter((r) => !e.dismissed.includes(r.key))
    .map((r) => (e.edits[r.key] != null ? { ...r, text: e.edits[r.key], edited: true } : r));
  for (const c of e.custom) out.push({ key: `custom:${c.id}`, text: c.text, custom: true });
  return out;
}

// How many of the four hotspots carry the primary term, for the card badge.
export function hotspotScore(terms: PlanTerm[], h: PageHotspots | null | undefined): { hits: number; total: number } | null {
  const p = primaryOf(terms);
  const c = p ? checkHotspots(p.keyword, h) : null;
  if (!c) return null;
  return { hits: Object.values(c).filter((m) => m === "hit").length, total: 4 };
}
