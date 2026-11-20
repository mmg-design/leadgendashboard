// What's left to spend on the two paid data APIs, and a daily Slack check so
// neither runs out unnoticed. Reading either balance is free.
//
// DataForSEO is prepaid dollars (backlink reports, prospect authority).
// SE Ranking's Data API is a monthly allowance of units (keyword research and
// the SEO tools Claude runs); rank tracking reads use the plan, not units.

import { getDb } from "./db";
import { postTeamUpdate } from "./slack";

export interface ApiBudget {
  dataforseo: { balance: number } | null;
  seranking: { unitsLeft: number; unitsLimit: number; renews: string } | null;
  checkedAt: string;
}

// Warn below these. DataForSEO's minimum top-up is $50.
const DFS_LOW = 10;
const DFS_CRITICAL = 2;
const SR_LOW_SHARE = 0.2;
// A low balance is posted again at most this often while it stays low.
const REMIND_DAYS = 7;

export async function getDataForSeoBalance(): Promise<number | null> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
    headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => null);
  const balance = body?.tasks?.[0]?.result?.[0]?.money?.balance;
  return typeof balance === "number" ? Math.round(balance * 100) / 100 : null;
}

export async function getSeRankingUnits(): Promise<ApiBudget["seranking"]> {
  const key = process.env.SERANKING_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.seranking.com/v1/account/subscription", {
    headers: { Authorization: `Token ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const info = (await res.json().catch(() => null))?.subscription_info;
  if (!info || typeof info.units_left !== "number") return null;
  // SE Ranking spells it "expiraton_date".
  return { unitsLeft: info.units_left, unitsLimit: info.units_limit, renews: String(info.expiraton_date || info.expiration_date || "").slice(0, 10) };
}

export async function getApiBudget(): Promise<ApiBudget> {
  const [dfs, sr] = await Promise.allSettled([getDataForSeoBalance(), getSeRankingUnits()]);
  return {
    dataforseo: dfs.status === "fulfilled" && dfs.value !== null ? { balance: dfs.value } : null,
    seranking: sr.status === "fulfilled" ? sr.value : null,
    checkedAt: new Date().toISOString(),
  };
}

// ── Daily check ─────────────────────────────────────────────────────────────

type Level = "ok" | "low" | "critical";

interface CheckState {
  dfsLevel: Level;
  srLevel: Level;
  dfsAlertedAt?: string;
  srAlertedAt?: string;
  // Last Monday's numbers, for the weekly "spent this week" line.
  weekBalance?: number;
  weekUnits?: number;
}

const STATE_KEY = { slug: "_system", metric: "api_budget", range: "state" };

async function readState(): Promise<CheckState> {
  const db = await getDb();
  const row = (await db.execute({
    sql: "SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = ? AND date_range = ?",
    args: [STATE_KEY.slug, STATE_KEY.metric, STATE_KEY.range],
  })).rows[0];
  return row ? JSON.parse(row.data as string) : { dfsLevel: "ok", srLevel: "ok" };
}

async function writeState(state: CheckState) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at) VALUES (?, ?, ?, ?, datetime('now'))`,
    args: [STATE_KEY.slug, STATE_KEY.metric, STATE_KEY.range, JSON.stringify(state)],
  });
}

const money = (n: number) => `$${n.toFixed(2)}`;
const units = (n: number) => n.toLocaleString("en-US");
const daysSince = (iso?: string) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);
const rank: Record<Level, number> = { ok: 0, low: 1, critical: 2 };

function dfsLevel(balance: number): Level {
  return balance < DFS_CRITICAL ? "critical" : balance < DFS_LOW ? "low" : "ok";
}
function srLevel(left: number, limit: number): Level {
  return left <= 0 ? "critical" : limit > 0 && left / limit < SR_LOW_SHARE ? "low" : "ok";
}

// Runs once a day. Posts to Slack when a balance first drops into low or
// critical (and again weekly while it stays there), plus a short summary of
// both every Monday. `dryRun` returns the messages without posting or saving.
export async function runBudgetCheck({ dryRun = false, now = new Date() } = {}) {
  const budget = await getApiBudget();
  const state = await readState();
  const next: CheckState = { ...state };
  const alerts: string[] = [];
  const stamp = now.toISOString();

  if (budget.dataforseo) {
    const b = budget.dataforseo.balance;
    const level = dfsLevel(b);
    const worse = rank[level] > rank[state.dfsLevel];
    if (level !== "ok" && (worse || daysSince(state.dfsAlertedAt) >= REMIND_DAYS)) {
      alerts.push(level === "critical"
        ? `:rotating_light: *DataForSEO is almost out: ${money(b)} left.* Backlink reports and prospect scores stop when it hits $0. Top up at app.dataforseo.com (minimum $50).`
        : `:warning: *DataForSEO is down to ${money(b)}.* That's a few weeks of backlink reports. Top up at app.dataforseo.com (minimum $50).`);
      next.dfsAlertedAt = stamp;
    }
    next.dfsLevel = level;
  }

  if (budget.seranking) {
    const { unitsLeft, unitsLimit, renews } = budget.seranking;
    const level = srLevel(unitsLeft, unitsLimit);
    const worse = rank[level] > rank[state.srLevel];
    if (level !== "ok" && (worse || daysSince(state.srAlertedAt) >= REMIND_DAYS)) {
      alerts.push(level === "critical"
        ? `:rotating_light: *SE Ranking data units are used up* (0 of ${units(unitsLimit)}). Keyword research and Claude's SEO tools stop until they renew${renews ? ` on ${renews}` : ""}. Rank tracking isn't affected.`
        : `:warning: *SE Ranking data units are low: ${units(unitsLeft)} of ${units(unitsLimit)} left*${renews ? `, renewing ${renews}` : ""}. Save them for research you choose to run. Rank tracking isn't affected.`);
      next.srAlertedAt = stamp;
    }
    next.srLevel = level;
  }

  // Monday summary (UTC).
  let summary: string | null = null;
  if (now.getUTCDay() === 1) {
    const lines = ["*Weekly data API budget*"];
    if (budget.dataforseo) {
      const b = budget.dataforseo.balance;
      const spent = state.weekBalance !== undefined ? state.weekBalance - b : null;
      const spentNote = spent === null ? "" : spent >= 0 ? `, spent ${money(spent)} this week` : ", topped up this week";
      const weeksLeft = spent && spent > 0 ? Math.floor(b / spent) : null;
      lines.push(`• DataForSEO: ${money(b)} left${spentNote}${weeksLeft !== null ? ` (about ${weeksLeft} ${weeksLeft === 1 ? "week" : "weeks"} at this pace)` : ""}`);
      next.weekBalance = b;
    } else lines.push("• DataForSEO: couldn't read the balance");
    if (budget.seranking) {
      const { unitsLeft, unitsLimit, renews } = budget.seranking;
      const used = state.weekUnits !== undefined && state.weekUnits >= unitsLeft ? state.weekUnits - unitsLeft : null;
      lines.push(`• SE Ranking data units: ${units(unitsLeft)} of ${units(unitsLimit)} left${used !== null ? `, ${units(used)} used this week` : ""}${renews ? `, renews ${renews}` : ""}`);
      next.weekUnits = unitsLeft;
    } else lines.push("• SE Ranking data units: couldn't read the balance");
    summary = lines.join("\n");
  }

  const messages = [...alerts, ...(summary ? [summary] : [])];
  if (!dryRun) {
    for (const text of messages) await postTeamUpdate(text);
    await writeState(next);
  }
  return { budget, messages, posted: !dryRun && messages.length > 0 };
}
