// Microsoft Clarity: daily snapshots so the dashboard's 7d/30d/90d toggle works.
//
// Clarity's export API only returns the last 1–3 days and allows ~10 calls per
// project per day. So we pull once a day per client, store the result, and add
// up stored snapshots for whatever window the dashboard asks for. Until enough
// days exist, daysCollected tells the UI how much of the window is real.
//
// Tokens are per Clarity project. A single global token returns one project's
// data for every client, so each client can carry its own token, and every
// pull is checked against the client's domain before it's stored.

import { getDb } from "./db";
import type { ClientConfig } from "./clients";
import {
  normalizePath,
  type ClarityDevice,
  type ClarityPage,
  type ClaritySummary,
  type IssueKind,
} from "./page-behavior";

const API_URL = "https://www.clarity.ms/export-data/api/v1/project-live-insights";
const RETRY_AFTER_FAILURE_MS = 2 * 60 * 60 * 1000;

// One row per (page, device) in a snapshot.
interface SnapshotRow {
  path: string;
  device: string;
  sessions: number;
  pagesPerSession: number;
  scrollDepth: number;
  rageClicks: number;
  deadClicks: number;
  quickbacks: number;
  errorClicks: number;
  ragePct: number;
  deadPct: number;
  quickbackPct: number;
  errorPct: number;
}

type NumericField = Exclude<keyof SnapshotRow, "path" | "device">;

// Clarity metricName -> our count/percent fields. Count is `subTotal`; the share
// of sessions affected is `sessionsWithMetricPercentage`.
const FRUSTRATION_METRICS: Record<string, { count: NumericField; pct: NumericField }> = {
  RageClickCount: { count: "rageClicks", pct: "ragePct" },
  DeadClickCount: { count: "deadClicks", pct: "deadPct" },
  QuickbackClick: { count: "quickbacks", pct: "quickbackPct" },
  ErrorClickCount: { count: "errorClicks", pct: "errorPct" },
};

const DEVICE_NAMES: Record<string, ClarityDevice["device"]> = {
  PC: "Desktop",
  Mobile: "Mobile",
  Tablet: "Tablet",
};

export function clarityToken(config: ClientConfig): string | null {
  return config.integrations.clarity?.apiToken || process.env.CLARITY_API_TOKEN || null;
}

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function hostMatches(url: string, domain: string) {
  if (!domain) return true;
  const want = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === want || host.endsWith(`.${want}`);
  } catch {
    return false;
  }
}

type FetchResult =
  | { ok: true; rows: SnapshotRow[] }
  | { ok: false; status: "domain_mismatch" | "error"; message: string };

async function fetchClarity(token: string, numOfDays: number, domain: string): Promise<FetchResult> {
  const res = await fetch(`${API_URL}?numOfDays=${numOfDays}&dimension1=URL&dimension2=Device`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    const message = res.status === 429
      ? "Clarity's daily request limit was reached. It will retry later."
      : `Clarity responded ${res.status}: ${body.slice(0, 160)}`;
    return { ok: false, status: "error", message };
  }

  const groups: { metricName: string; information?: Record<string, unknown>[] }[] = (await res.json()) || [];
  const rows = new Map<string, SnapshotRow>();
  const foreignHosts = new Set<string>();
  let sawAnyUrl = false;

  const rowFor = (item: Record<string, unknown>) => {
    const url = String(item.Url ?? item.URL ?? "");
    if (!url) return null;
    sawAnyUrl = true;
    if (!hostMatches(url, domain)) {
      try { foreignHosts.add(new URL(url).hostname); } catch { /* ignore */ }
      return null;
    }
    const path = normalizePath(url);
    const device = String(item.Device ?? "Other");
    const key = `${path}|${device}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        path, device, sessions: 0, pagesPerSession: 0, scrollDepth: 0,
        rageClicks: 0, deadClicks: 0, quickbacks: 0, errorClicks: 0,
        ragePct: 0, deadPct: 0, quickbackPct: 0, errorPct: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  // Clarity reports "/#pricing" and "/" as separate URLs. They share a path
  // here, so values are folded together weighted by each URL's own sessions.
  const sessionsByUrl = new Map<string, number>();
  for (const group of groups) {
    if (group.metricName !== "Traffic") continue;
    for (const item of group.information || []) {
      sessionsByUrl.set(`${item.Url ?? item.URL}|${item.Device}`, Number(item.totalSessionCount) || 0);
    }
  }

  // Pass 1: session totals. Clarity lists the Traffic group after the scroll
  // and click groups, so totals must exist before anything is weighted by them.
  for (const group of groups) {
    if (group.metricName !== "Traffic") continue;
    for (const item of group.information || []) {
      const row = rowFor(item);
      if (!row) continue;
      const weight = sessionsByUrl.get(`${item.Url ?? item.URL}|${item.Device}`) || 0;
      const prev = row.sessions;
      row.sessions += weight;
      // Clarity names this "pagesPerSessionPercentage" but the value is pages
      // per session (a plain average like 1.4), not a percentage.
      const pps = Number(item.pagesPerSessionPercentage) || 0;
      row.pagesPerSession = row.sessions ? (row.pagesPerSession * prev + pps * weight) / row.sessions : 0;
    }
  }

  // Pass 2: everything else, weighted by each URL's share of its path's sessions.
  for (const group of groups) {
    if (group.metricName === "Traffic") continue;
    for (const item of group.information || []) {
      const row = rowFor(item);
      if (!row) continue;
      const weight = sessionsByUrl.get(`${item.Url ?? item.URL}|${item.Device}`) || 0;

      if (group.metricName === "ScrollDepth") {
        row.scrollDepth = weightedAdd(row.scrollDepth, row, Number(item.averageScrollDepth) || 0, weight);
      } else if (FRUSTRATION_METRICS[group.metricName]) {
        const { count, pct } = FRUSTRATION_METRICS[group.metricName];
        row[count] += Number(item.subTotal) || 0;
        row[pct] = weightedAdd(row[pct], row, Number(item.sessionsWithMetricPercentage) || 0, weight);
      }
    }
  }

  if (sawAnyUrl && rows.size === 0) {
    const hosts = [...foreignHosts].slice(0, 2).join(", ");
    return {
      ok: false,
      status: "domain_mismatch",
      message: `This Clarity token returns data for ${hosts || "a different site"}, not ${domain}. Add this client's own Clarity API token in Settings.`,
    };
  }

  return { ok: true, rows: [...rows.values()].filter((r) => r.sessions > 0) };
}

// Running average for a value folded across several Clarity URLs that share a path.
// Sessions are summed in pass 1, so `row.sessions` is already the path total.
function weightedAdd(current: number, row: SnapshotRow, value: number, weight: number) {
  if (!row.sessions || !weight) return current;
  return current + (value * weight) / row.sessions;
}

interface EnsureResult {
  status: "ok" | "token_missing" | "domain_mismatch" | "error";
  message?: string;
}

// Stores today's snapshot if it doesn't exist yet. If days were missed, asks
// Clarity for up to 3 days so the gap is filled.
export async function ensureClaritySnapshot(slug: string, config: ClientConfig): Promise<EnsureResult> {
  const token = clarityToken(config);
  if (!token) {
    return { status: "token_missing", message: "Add this client's Clarity API token in Settings." };
  }

  const db = await getDb();
  const today = utcDate();

  const existing = await db.execute({
    sql: "SELECT 1 FROM clarity_snapshots WHERE client_slug = ? AND snapshot_date = ?",
    args: [slug, today],
  });
  if (existing.rows.length > 0) return { status: "ok" };

  // Don't spend Clarity's ~10/day quota retrying on every page load.
  const lastAttempt = await db.execute({
    sql: `SELECT data, fetched_at FROM analytics_cache
          WHERE client_slug = ? AND metric_type = 'clarity_last_failure' AND date_range = 'live'`,
    args: [slug],
  });
  if (lastAttempt.rows.length > 0) {
    // SQLite's datetime('now') is UTC without a zone marker: "YYYY-MM-DD HH:MM:SS".
    const at = Date.parse(`${String(lastAttempt.rows[0].fetched_at).replace(" ", "T")}Z`);
    if (Date.now() - at < RETRY_AFTER_FAILURE_MS) {
      const failure = JSON.parse(lastAttempt.rows[0].data as string) as EnsureResult;
      return failure;
    }
  }

  const last = await db.execute({
    sql: "SELECT MAX(snapshot_date) AS last FROM clarity_snapshots WHERE client_slug = ?",
    args: [slug],
  });
  const lastDate = (last.rows[0]?.last as string | null) ?? null;
  const numOfDays = lastDate ? Math.min(Math.max(daysBetween(lastDate, today), 1), 3) : 3;

  let result: FetchResult;
  try {
    result = await fetchClarity(token, numOfDays, config.domain);
  } catch (err) {
    result = { ok: false, status: "error", message: err instanceof Error ? err.message : "Clarity request failed" };
  }

  if (!result.ok) {
    const failure: EnsureResult = { status: result.status, message: result.message };
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'clarity_last_failure', 'live', ?, datetime('now'))`,
      args: [slug, JSON.stringify(failure)],
    });
    return failure;
  }

  await db.execute({
    sql: `INSERT OR IGNORE INTO clarity_snapshots (client_slug, snapshot_date, days_covered, data)
          VALUES (?, ?, ?, ?)`,
    args: [slug, today, numOfDays, JSON.stringify(result.rows)],
  });
  await db.execute({
    sql: `DELETE FROM analytics_cache WHERE client_slug = ? AND metric_type = 'clarity_last_failure'`,
    args: [slug],
  });
  return { status: "ok" };
}

interface Accumulator {
  sessions: number;
  scrollSum: number; // scrollDepth × sessions
  rageClicks: number;
  deadClicks: number;
  quickbacks: number;
  errorClicks: number;
  rageSessions: number; // pct × sessions / 100
  deadSessions: number;
  quickbackSessions: number;
  errorSessions: number;
}

function emptyAcc(): Accumulator {
  return {
    sessions: 0, scrollSum: 0, rageClicks: 0, deadClicks: 0, quickbacks: 0, errorClicks: 0,
    rageSessions: 0, deadSessions: 0, quickbackSessions: 0, errorSessions: 0,
  };
}

function addRow(acc: Accumulator, r: SnapshotRow) {
  acc.sessions += r.sessions;
  acc.scrollSum += r.scrollDepth * r.sessions;
  acc.rageClicks += r.rageClicks;
  acc.deadClicks += r.deadClicks;
  acc.quickbacks += r.quickbacks;
  acc.errorClicks += r.errorClicks;
  acc.rageSessions += (r.ragePct * r.sessions) / 100;
  acc.deadSessions += (r.deadPct * r.sessions) / 100;
  acc.quickbackSessions += (r.quickbackPct * r.sessions) / 100;
  acc.errorSessions += (r.errorPct * r.sessions) / 100;
}

function issuePcts(acc: Accumulator): Record<IssueKind, number> {
  const s = acc.sessions || 1;
  return {
    rage: (acc.rageSessions / s) * 100,
    dead: (acc.deadSessions / s) * 100,
    quickback: (acc.quickbackSessions / s) * 100,
    error: (acc.errorSessions / s) * 100,
  };
}

// Share of visits with at least one signal. Signals overlap, so the largest
// single one is a safe lower bound (adding them up would double count).
function frustration(acc: Accumulator) {
  const pcts = issuePcts(acc);
  const [kind, pct] = (Object.entries(pcts) as [IssueKind, number][]).sort((a, b) => b[1] - a[1])[0];
  return { frustratedPct: pct, topIssue: pct > 0 ? { kind, pct } : null };
}

export async function getClaritySummary(
  slug: string,
  config: ClientConfig,
  rangeDays: number,
  ensure: EnsureResult
): Promise<ClaritySummary> {
  const projectId = config.integrations.clarity?.projectId || "";
  const db = await getDb();
  const since = utcDate(new Date(Date.now() - (rangeDays - 1) * 86_400_000));

  const snaps = await db.execute({
    sql: `SELECT days_covered, data FROM clarity_snapshots
          WHERE client_slug = ? AND snapshot_date >= ? ORDER BY snapshot_date`,
    args: [slug, since],
  });

  const byPath = new Map<string, Accumulator>();
  const byDevice = new Map<string, Accumulator>();
  const total = emptyAcc();
  let daysCollected = 0;

  for (const snap of snaps.rows) {
    daysCollected += Number(snap.days_covered) || 0;
    const rows = JSON.parse(snap.data as string) as SnapshotRow[];
    for (const r of rows) {
      if (!byPath.has(r.path)) byPath.set(r.path, emptyAcc());
      addRow(byPath.get(r.path)!, r);
      const device = DEVICE_NAMES[r.device];
      if (device) {
        if (!byDevice.has(device)) byDevice.set(device, emptyAcc());
        addRow(byDevice.get(device)!, r);
      }
      addRow(total, r);
    }
  }

  const pages: ClarityPage[] = [...byPath.entries()]
    .map(([path, acc]) => ({
      path,
      sessions: acc.sessions,
      scrollDepth: acc.sessions ? acc.scrollSum / acc.sessions : 0,
      rageClicks: acc.rageClicks,
      deadClicks: acc.deadClicks,
      quickbacks: acc.quickbacks,
      errorClicks: acc.errorClicks,
      ...frustration(acc),
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 50);

  const devices: ClarityDevice[] = [...byDevice.entries()].map(([device, acc]) => ({
    device: device as ClarityDevice["device"],
    sessions: acc.sessions,
    scrollDepth: acc.sessions ? acc.scrollSum / acc.sessions : 0,
    frustratedPct: frustration(acc).frustratedPct,
  }));

  const home = pages.find((p) => p.path === "/");
  daysCollected = Math.min(daysCollected, rangeDays);

  let status: ClaritySummary["status"] = ensure.status;
  if (status === "ok" && daysCollected < rangeDays) status = "collecting";
  // A failed pull doesn't hide data that's already stored.
  if (status === "error" && daysCollected > 0) status = "collecting";

  return {
    status,
    message: ensure.message,
    projectId,
    dashboardUrl: `https://clarity.microsoft.com/projects/view/${projectId}/dashboard`,
    rangeDays,
    daysCollected,
    pages,
    devices,
    rageClicks: total.rageClicks,
    deadClicks: total.deadClicks,
    homepageScrollDepth: home ? Math.round(home.scrollDepth) : null,
  };
}
