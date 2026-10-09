// Plain-language reads on SE Ranking keywords: is it a brand search, what is
// the searcher trying to do, and which tracked keywords fit a given page.
//
// Rule-based on purpose. Every label can be explained by the words in the
// keyword, so a client asking "why is this commercial?" gets a real answer.
// Pure functions only, safe for client components and API routes.

import { normalizePath } from "./page-behavior";

export type KeywordIntent = "navigational" | "transactional" | "commercial" | "informational" | "local" | "topic";

export interface KeywordType {
  branded: boolean;
  intent: KeywordIntent;
  label: string; // e.g. "Brand · Navigational"
  explanation: string;
}

// SE Ranking keyword enriched by /api/seranking.
export interface RankedKeyword {
  id: string;
  keyword: string;
  position: number; // 0 = not in the top 100
  delta: number | null; // positions gained over 7 days
  bestThisMonth?: number | null;
  volume?: number | null; // monthly searches
  competition?: number | null; // 0-1, paid-search competition
  cpc?: number | null;
  landingUrl?: string | null; // full URL SE Ranking saw ranking
  landingPath?: string | null; // path, only when it's on the client's own site
  inAiOverview?: boolean;
  type?: KeywordType;
}

// Category words that appear in client names but aren't a brand on their own:
// "Exact Medicare" is branded by "exact", not by "medicare".
const GENERIC = new Set([
  "the", "and", "of", "medicare", "insurance", "health", "healthcare", "benefits", "pharmacy",
  "sports", "performance", "design", "studio", "team", "translation", "translations", "club",
  "group", "agency", "services", "service", "social", "marketing", "company", "inc", "llc", "co",
]);

export function brandTerms(name: string, domain: string): string[] {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
  const root = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0];
  return [...new Set([...words, root].filter(Boolean))];
}

function editDistanceAtMostOne(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function isBranded(keyword: string, brands: string[]) {
  const words = keyword.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const squashed = words.join("");
  return brands.some((brand) => {
    if (brand.length >= 6 && squashed.includes(brand)) return true;
    // Misspellings count: "exxact" and "xact" are still people looking for Exact.
    return brand.length >= 4 && words.some((w) => w === brand || w.startsWith(brand) || editDistanceAtMostOne(w, brand));
  });
}

const has = (k: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(k));

const NAV_WORDS = ["login", "log in", "portal", "phone", "number", "address", "hours", "careers", "jobs", "contact"];
const LOCAL_WORDS = ["near me", "nearby", "local"];
const TRANSACTIONAL_WORDS = [
  "quote", "quotes", "buy", "enroll", "enrollment", "sign up", "apply", "application", "cost", "costs",
  "price", "pricing", "rates", "hire", "book", "schedule", "free consultation", "get",
];
const COMMERCIAL_WORDS = [
  "best", "top", "vs", "versus", "compare", "comparison", "review", "reviews", "alternative", "alternatives",
  "agency", "agencies", "agent", "agents", "broker", "brokers", "company", "companies", "provider", "providers",
  "plan", "plans", "services", "service", "consultant", "firm",
];
const INFO_WORDS = [
  "what", "how", "when", "why", "who", "which", "is", "are", "does", "do", "can", "guide", "tips", "101",
  "explained", "meaning", "definition", "difference", "checklist", "requirements",
];

const INTENT_COPY: Record<KeywordIntent, { label: string; explanation: string }> = {
  navigational: {
    label: "Navigational",
    explanation: "Someone looking for this business specifically. You should own the top 3 spots for these.",
  },
  local: {
    label: "Local",
    explanation: "Someone looking for a provider nearby. Location pages and a complete Google Business Profile win these.",
  },
  transactional: {
    label: "Ready to act",
    explanation: "Someone close to taking a step (a quote, enrolling, booking). Rankings here turn into leads fastest.",
  },
  commercial: {
    label: "Comparing options",
    explanation: "Someone weighing providers before choosing. Service and comparison pages win these.",
  },
  informational: {
    label: "Researching",
    explanation: "Someone learning about a topic. Guides and blog posts win these and build trust before they're ready to buy.",
  },
  topic: {
    label: "Broad topic",
    explanation: "A short, general search. Usually takes a strong page dedicated to the subject plus links from other sites.",
  },
};

export function classifyKeyword(keyword: string, brands: string[]): KeywordType {
  const k = keyword.toLowerCase();
  const branded = isBranded(k, brands);
  let intent: KeywordIntent;
  if (has(k, LOCAL_WORDS)) intent = "local";
  else if (branded || has(k, NAV_WORDS)) intent = "navigational";
  else if (has(k, INFO_WORDS)) intent = "informational";
  else if (has(k, TRANSACTIONAL_WORDS)) intent = "transactional";
  else if (has(k, COMMERCIAL_WORDS)) intent = "commercial";
  else intent = "topic";

  const copy = INTENT_COPY[intent];
  return {
    branded,
    intent,
    label: `${branded ? "Brand" : "Non-brand"} · ${copy.label}`,
    explanation: branded && intent !== "navigational"
      ? `Includes the brand name. ${copy.explanation}`
      : copy.explanation,
  };
}

// ── Page ↔ keyword matching ────────────────────────────────────────────────

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "your", "you", "my", "is", "are", "what", "how", "when", "why", "do", "does", "can", "blog", "www"]);

function stem(w: string) {
  return w.replace(/(ments?|ings?|ies|es|s)$/, "") || w;
}

function tokens(text: string) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
}

export function keywordsForPage(path: string, keywords: RankedKeyword[]): RankedKeyword[] {
  const target = normalizePath(path);
  return keywords
    .filter((k) => k.position > 0 && k.landingPath && normalizePath(k.landingPath) === target)
    .sort((a, b) => a.position - b.position);
}

export interface TargetSuggestion {
  keyword: RankedKeyword;
  reason: string;
}

// Tracked keywords this page is the natural home for but doesn't win yet:
// not ranking at all, or ranking past page 2 somewhere else. Scored by words
// shared with the page URL, weighted so words in every keyword ("medicare"
// for a Medicare agency) count for little and specific words count for a lot.
export function targetsForPage(path: string, keywords: RankedKeyword[], limit = 3): TargetSuggestion[] {
  const target = normalizePath(path);
  const pageTokens = new Set(tokens(target));
  const isHome = target === "/";

  const df = new Map<string, number>();
  for (const k of keywords) for (const t of new Set(tokens(k.keyword))) df.set(t, (df.get(t) || 0) + 1);
  const n = keywords.length || 1;

  const candidates = keywords.filter((k) => {
    const onThisPage = k.landingPath && normalizePath(k.landingPath) === target;
    if (onThisPage && k.position > 0 && k.position <= 20) return false; // already doing fine here
    return k.position === 0 || k.position > 20;
  });

  const scored = candidates
    .map((k) => {
      let score = 0;
      const shared: string[] = [];
      for (const t of new Set(tokens(k.keyword))) {
        if (pageTokens.has(t)) {
          score += Math.log(n / (df.get(t) || 1)) + 0.25;
          shared.push(t);
        }
      }
      // The homepage has no topic words in its URL; it's the natural target for brand searches.
      if (isHome && k.type?.branded) score += 1.5;
      return { k, score, shared };
    })
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score || (b.k.volume || 0) - (a.k.volume || 0))
    .slice(0, limit);

  return scored.map(({ k, shared }) => {
    const here = !!k.landingPath && normalizePath(k.landingPath) === target;
    const where = k.position === 0
      ? "Not ranking yet."
      : here
      ? `Already ranks #${k.position} here; worth pushing onto page 1.`
      : `Ranks #${k.position}${k.landingPath ? ` on ${k.landingPath}` : ""} instead.`;
    const why = isHome && k.type?.branded && shared.length === 0
      ? "Brand searches should land on the homepage"
      : `Matches this page's topic (${shared.join(", ")})`;
    return { keyword: k, reason: `${why}. ${where}` };
  });
}
