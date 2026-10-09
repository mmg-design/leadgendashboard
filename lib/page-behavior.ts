// Plain-language page labels built from GA4 + Microsoft Clarity.
//
// Pure functions only (no server imports) so client components and API routes
// can share the exact same thresholds. Change a threshold here and every card,
// the AI analysis, and the action list all move together.
//
// Time-based judgments come from GA4's per-page engagement rate, which follows
// the dashboard's 7d/30d/90d window. Clarity's EngagementTime fields are not
// used: its export API doesn't say whether activeTime is a per-visit average or
// a total, so a threshold on it would be a guess.

export type IssueKind = "rage" | "dead" | "quickback" | "error";

export interface ClarityPage {
  path: string;
  sessions: number;
  scrollDepth: number; // avg % of the page scrolled
  frustratedPct: number; // % of sessions with at least one frustration signal (lower bound)
  rageClicks: number;
  deadClicks: number;
  quickbacks: number;
  errorClicks: number;
  topIssue: { kind: IssueKind; pct: number } | null;
}

export interface ClarityDevice {
  device: "Desktop" | "Mobile" | "Tablet";
  sessions: number;
  scrollDepth: number;
  frustratedPct: number;
}

export type ClarityStatus = "ok" | "collecting" | "token_missing" | "domain_mismatch" | "error";

export interface ClaritySummary {
  status: ClarityStatus;
  message?: string;
  projectId: string;
  dashboardUrl: string;
  rangeDays: number;
  daysCollected: number; // how much of rangeDays is backed by stored snapshots
  pages: ClarityPage[];
  devices: ClarityDevice[];
  // Sitewide totals for the window. Kept under their original names so the
  // Lead Funnel action items and AI analysis keep working.
  rageClicks: number;
  deadClicks: number;
  homepageScrollDepth: number | null;
}

export type PageLabel = "Strong" | "Okay" | "Ignored" | "Leaking" | "Low data";

export interface GaPage {
  page: string;
  views: number;
  engagementScore?: number; // GA4 engagement rate, 0-100
  avgDuration?: number;
}

export interface LabeledPage {
  path: string;
  views: number;
  label: PageLabel;
  reason: string;
}

// ── Thresholds ──────────────────────────────────────────────────────────────
const MIN_VIEWS = 10; // GA views in the window before we judge a page
const MIN_CLARITY_SESSIONS = 10; // Clarity sessions before its signals count
const LEAKING_FRUSTRATED_PCT = 10; // ≥ this % of visits hit a frustration signal
const STRONG_ENGAGEMENT = 65; // GA engagement rate %
const IGNORED_ENGAGEMENT = 40;
const STRONG_MIN_SCROLL = 40; // Clarity avg scroll % (only when Clarity has data)
const IGNORED_MAX_SCROLL = 25;

export const LABEL_DEFINITIONS: Record<PageLabel, string> = {
  Strong: `People engage with this page (${STRONG_ENGAGEMENT}%+ of visits) and don't run into problems.`,
  Okay: "Nothing is wrong here, and nothing stands out either.",
  Ignored: `Most visitors leave without reading: under ${IGNORED_ENGAGEMENT}% of visits engage, or they scroll less than a quarter of the page.`,
  Leaking: `Visitors hit problems: ${LEAKING_FRUSTRATED_PCT}%+ of visits include rage clicks, dead clicks, error clicks, or quick backs.`,
  "Low data": `Fewer than ${MIN_VIEWS} views in this window. Too few to judge.`,
};

const ISSUE_TEXT: Record<IssueKind, string> = {
  rage: "rage clicks (repeated clicking in frustration)",
  dead: "dead clicks (clicking something that does nothing)",
  quickback: "quick backs (they left and came straight back)",
  error: "clicks that triggered an error",
};

export function normalizePath(raw: string): string {
  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.split("#")[0].split("?")[0];
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

export function labelPage(ga: GaPage, clarity?: ClarityPage): LabeledPage {
  const path = normalizePath(ga.page);
  const er = ga.engagementScore;
  const hasClarity = !!clarity && clarity.sessions >= MIN_CLARITY_SESSIONS;
  const base = { path, views: ga.views };

  if (ga.views < MIN_VIEWS && !hasClarity) {
    return { ...base, label: "Low data", reason: `Only ${ga.views} views in this window.` };
  }

  if (hasClarity && clarity!.frustratedPct >= LEAKING_FRUSTRATED_PCT && clarity!.topIssue) {
    const pct = Math.round(clarity!.topIssue.pct);
    return {
      ...base,
      label: "Leaking",
      reason: `${pct}% of visits hit ${ISSUE_TEXT[clarity!.topIssue.kind]}.`,
    };
  }

  if (er !== undefined && er < IGNORED_ENGAGEMENT) {
    return { ...base, label: "Ignored", reason: `Only ${er}% of visits engage (scroll, click, or stay 10s+).` };
  }
  if (hasClarity && clarity!.scrollDepth < IGNORED_MAX_SCROLL) {
    return {
      ...base,
      label: "Ignored",
      reason: `Visitors scroll ${Math.round(clarity!.scrollDepth)}% of the page on average.`,
    };
  }

  const strongByScroll = !hasClarity || (clarity!.scrollDepth >= STRONG_MIN_SCROLL && clarity!.frustratedPct < 5);
  if (er !== undefined && er >= STRONG_ENGAGEMENT && strongByScroll) {
    const scrollNote = hasClarity ? ` and read ${Math.round(clarity!.scrollDepth)}% of the page` : "";
    return { ...base, label: "Strong", reason: `${er}% of visits engage${scrollNote}.` };
  }

  const parts: string[] = [];
  if (er !== undefined) parts.push(`${er}% of visits engage`);
  if (hasClarity) parts.push(`visitors scroll ${Math.round(clarity!.scrollDepth)}% of the page`);
  return {
    ...base,
    label: "Okay",
    reason: parts.length ? `${capitalize(parts.join(", "))}.` : "No warning signs.",
  };
}

export function labelPages(gaPages: GaPage[], clarityPages: ClarityPage[] = []): LabeledPage[] {
  const byPath = new Map(clarityPages.map((p) => [p.path, p]));
  return gaPages.map((p) => labelPage(p, byPath.get(normalizePath(p.page))));
}

export interface PageActions {
  fixFirst: LabeledPage[];
  promote: LabeledPage[];
}

// Combines traffic (GA) with behavior (labels) into two short lists:
//   Fix first: a busy page that's Leaking or Ignored. Fixing it helps the most visitors.
//   Promote:   a Strong page that's not getting much traffic. Send more people to it.
export function pageActions(labeled: LabeledPage[]): PageActions {
  const judged = labeled.filter((p) => p.label !== "Low data");
  const sortedViews = judged.map((p) => p.views).sort((a, b) => a - b);
  const median = sortedViews.length ? sortedViews[Math.floor(sortedViews.length / 2)] : 0;
  const isBusy = (p: LabeledPage) => p.views >= median && p.views >= MIN_VIEWS * 2;

  const fixFirst = judged
    .filter((p) => isBusy(p) && (p.label === "Leaking" || p.label === "Ignored"))
    .sort((a, b) => b.views - a.views)
    .slice(0, 3);
  const promote = judged
    .filter((p) => !isBusy(p) && p.label === "Strong")
    .sort((a, b) => b.views - a.views)
    .slice(0, 2);
  return { fixFirst, promote };
}

export interface GaDevice {
  device: string; // GA deviceCategory: desktop | mobile | tablet
  sessions: number;
  engagementRate: number; // 0-100
}

// One comparison sentence, or null when mobile and desktop look about the same.
// Prefers Clarity's frustration signal (most actionable), then GA engagement.
export function deviceInsight(gaDevices: GaDevice[], clarityDevices: ClarityDevice[] = []): string | null {
  const cMobile = clarityDevices.find((d) => d.device === "Mobile");
  const cDesktop = clarityDevices.find((d) => d.device === "Desktop");
  if (cMobile && cDesktop && cMobile.sessions >= MIN_CLARITY_SESSIONS && cDesktop.sessions >= MIN_CLARITY_SESSIONS) {
    const diff = cMobile.frustratedPct - cDesktop.frustratedPct;
    if (Math.abs(diff) >= 5) {
      const worse = diff > 0 ? "Mobile" : "Desktop";
      const [hi, lo] = diff > 0 ? [cMobile, cDesktop] : [cDesktop, cMobile];
      return `${worse} visitors run into problems more often: ${Math.round(hi.frustratedPct)}% of visits vs ${Math.round(lo.frustratedPct)}%.`;
    }
    const scrollDiff = cMobile.scrollDepth - cDesktop.scrollDepth;
    if (Math.abs(scrollDiff) >= 15) {
      return scrollDiff < 0
        ? `Mobile visitors read less of each page: ${Math.round(cMobile.scrollDepth)}% scrolled vs ${Math.round(cDesktop.scrollDepth)}% on desktop.`
        : `Mobile visitors read more of each page: ${Math.round(cMobile.scrollDepth)}% scrolled vs ${Math.round(cDesktop.scrollDepth)}% on desktop.`;
    }
  }

  const gMobile = gaDevices.find((d) => d.device === "mobile");
  const gDesktop = gaDevices.find((d) => d.device === "desktop");
  if (gMobile && gDesktop && gMobile.sessions >= MIN_VIEWS && gDesktop.sessions >= MIN_VIEWS) {
    const diff = gMobile.engagementRate - gDesktop.engagementRate;
    if (Math.abs(diff) >= 10) {
      return diff < 0
        ? `Mobile visits engage less: ${gMobile.engagementRate}% vs ${gDesktop.engagementRate}% on desktop.`
        : `Mobile visits engage more: ${gMobile.engagementRate}% vs ${gDesktop.engagementRate}% on desktop.`;
    }
    return "Mobile and desktop visitors engage about the same.";
  }
  return null;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
