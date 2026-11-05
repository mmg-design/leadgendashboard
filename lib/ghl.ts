import type { ClientConfig } from "./clients";

// GoHighLevel (LeadConnector) API v2 with a sub-account Private Integration
// token (Settings → Private Integrations; scopes: forms.readonly and
// locations.readonly). Lead events of type "ghl_form" are counted straight from
// GHL's form submissions, so they include history from before the event was
// added and don't depend on anything firing on the client's site.

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
const DAY = 86_400_000;

export class GhlError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function ghl<T>(token: string, path: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${API}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 240);
    try {
      const body = JSON.parse(text) as { message?: string | string[] };
      message = (Array.isArray(body.message) ? body.message.join(", ") : body.message) || message;
    } catch { /* plain text */ }
    if (res.status === 401) message = "GoHighLevel rejected the token. Create a new Private Integration token in the sub-account and paste it in Settings.";
    if (res.status === 403) message = `The GoHighLevel token is missing a permission (${message}). Give it the forms.readonly and locations.readonly scopes.`;
    if (res.status === 429) message = "GoHighLevel is rate limiting requests. Wait a minute and try again.";
    throw new GhlError(message, res.status);
  }
  return (await res.json()) as T;
}

export function ghlAuth(config: ClientConfig) {
  const g = config.integrations.gohighlevel;
  return g?.enabled && g.apiToken && g.locationId ? { token: g.apiToken, locationId: g.locationId, timezone: g.timezone || "America/New_York" } : null;
}

export async function getLocation(token: string, locationId: string) {
  const data = await ghl<{ location?: { id: string; name?: string; timezone?: string } }>(token, `/locations/${locationId}`, {});
  if (!data.location) throw new GhlError("GoHighLevel didn't return that sub-account. Check the Location ID.", 404);
  return { name: data.location.name || "", timezone: data.location.timezone || "" };
}

export interface GhlForm { id: string; name: string }

export async function listForms(token: string, locationId: string): Promise<GhlForm[]> {
  const data = await ghl<{ forms?: { id: string; name: string }[] }>(token, "/forms/", { locationId, limit: 50 });
  return (data.forms || []).map((f) => ({ id: f.id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name));
}

interface RawSubmission {
  createdAt: string;
  others?: { eventData?: { source?: string; medium?: string; referrer?: string; adSource?: string } };
}

// Every submission of one form between two dates (YYYY-MM-DD, inclusive).
async function formSubmissions(token: string, locationId: string, formId: string, startAt: string, endAt: string) {
  const all: RawSubmission[] = [];
  for (let page = 1; page <= 50; page++) {
    const data = await ghl<{ submissions?: RawSubmission[]; meta?: { nextPage?: number | null } }>(token, "/forms/submissions", {
      locationId, formId, startAt, endAt, page, limit: 100,
    });
    all.push(...(data.submissions || []));
    if (!data.meta?.nextPage) break;
  }
  return all;
}

// GHL labels a submission's attribution in words ("Organic Search", "Paid
// Social"...). Turn it into GA4's "source / medium" shape so the funnel's
// hover text reads the same for GHL and GA4 lead events.
function sourceMedium(event: NonNullable<RawSubmission["others"]>["eventData"]): string {
  const label = (event?.source || "").toLowerCase();
  let host = "";
  try { host = event?.referrer ? new URL(event.referrer).hostname.replace(/^www\./, "") : ""; } catch { /* not a URL */ }
  // The site's name without subdomain or TLD: m.facebook.com → facebook, google.co.uk → google.
  const labels = host.split(".");
  const site = (labels.length > 2 && /^(co|com|org|net)$/.test(labels[labels.length - 2]) ? labels[labels.length - 3] : labels[labels.length - 2] ?? labels[0]) || "";
  if (!label || label.includes("direct")) return "(direct) / (none)";
  if (label.includes("organic")) return `${site || "search"} / organic`;
  if (label.includes("paid")) return `${site || event?.adSource || "an ad"} / cpc`;
  if (label.includes("social")) return `${site || "social"} / social`;
  if (label.includes("email")) return "email / email";
  if (label.includes("referral")) return `${host || "another site"} / referral`;
  return `${event?.source} / (not set)`;
}

// A day (YYYY-MM-DD) in the sub-account's timezone, and day arithmetic on it.
function dayIn(timezone: string, date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function shiftDay(day: string, by: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY).toISOString().slice(0, 10);
}

// Submissions per day between two days, inclusive, in the sub-account's timezone.
export async function dailySubmissions(auth: NonNullable<ReturnType<typeof ghlAuth>>, formId: string, from: string, to: string) {
  // GHL reads startAt/endAt as UTC midnight, and endAt excludes its own day, so
  // a US evening submission on `to` lands after endAt = to + 1. Ask for two
  // days past the end (and one before the start) and bucket by local day ourselves.
  const rows = await formSubmissions(auth.token, auth.locationId, formId, shiftDay(from, -1), shiftDay(to, 2));
  const byDay = new Map<string, { count: number; sources: Map<string, number> }>();
  for (const row of rows) {
    const day = dayIn(auth.timezone, new Date(row.createdAt));
    if (day < from || day > to) continue;
    const entry = byDay.get(day) || { count: 0, sources: new Map() };
    entry.count++;
    const source = sourceMedium(row.others?.eventData);
    entry.sources.set(source, (entry.sources.get(source) || 0) + 1);
    byDay.set(day, entry);
  }
  return byDay;
}

// The funnel's lead-event result for a GHL form, in the same shape as the GA4
// ones: the last `days` complete days (ending `lagDays` back), the period
// before it, a daily series, and the top sources.
export async function ghlGoalResult(auth: NonNullable<ReturnType<typeof ghlAuth>>, formId: string, days: number, lagDays: number) {
  const end = shiftDay(dayIn(auth.timezone, new Date()), -lagDays);
  const start = shiftDay(end, -(days - 1));
  const previousStart = shiftDay(start, -days);
  const byDay = await dailySubmissions(auth, formId, previousStart, end);

  let count = 0;
  let previousCount = 0;
  const daily: { date: string; count: number }[] = [];
  const sources = new Map<string, number>();
  for (let day = start; day <= end; day = shiftDay(day, 1)) daily.push({ date: day, count: byDay.get(day)?.count || 0 });
  for (const [day, entry] of byDay) {
    if (day < start) {
      previousCount += entry.count;
      continue;
    }
    count += entry.count;
    for (const [source, n] of entry.sources) sources.set(source, (sources.get(source) || 0) + n);
  }

  return {
    count,
    previousCount,
    change: previousCount > 0 ? Math.round(((count - previousCount) / previousCount) * 100) : null,
    daily,
    sources: [...sources].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([source, n]) => ({ source, count: n })),
  };
}
