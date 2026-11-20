// DataForSEO API client, used for backlink data (lib/backlinks.ts). Rank
// tracking and AI visibility stay on SE Ranking.
//
// Auth is HTTP Basic with the API login and API password from
// app.dataforseo.com/api-access (not the account password). Every call is one
// task in, one result out: { tasks: [{ status_code, result: [ ... ] }] }.
// Codes 20000 mean OK; 402xx are billing or subscription problems.

const BASE = "https://api.dataforseo.com/v3";
// DataForSEO allows 2,000 calls a minute but caps simultaneous requests, so a
// report's lookups run a handful at a time.
const MAX_IN_FLIGHT = 8;

export const dataForSeoConnected = () => !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);

let inFlight = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (inFlight < MAX_IN_FLIGHT) { inFlight++; return; }
  await new Promise<void>((r) => waiting.push(r));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}

interface Envelope<T> {
  status_code: number;
  status_message: string;
  tasks?: { status_code: number; status_message: string; result: T[] | null }[];
}

// Posts one task and returns its first result, or null when DataForSEO has no
// data for the target.
export async function dfs<T>(path: string, task: Record<string, unknown>): Promise<T | null> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DataForSEO isn't connected");
  const auth = Buffer.from(`${login}:${password}`).toString("base64");

  for (let attempt = 0; ; attempt++) {
    await acquire();
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify([task]),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
    } finally {
      release();
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const body = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!body) throw new Error(`DataForSEO ${res.status}: unreadable response`);
    if (body.status_code !== 20000) throw new Error(`DataForSEO ${body.status_code}: ${body.status_message}`);
    const t = body.tasks?.[0];
    if (!t) throw new Error("DataForSEO returned no task");
    if (t.status_code !== 20000) throw new Error(`DataForSEO ${t.status_code}: ${t.status_message}`);
    return t.result?.[0] ?? null;
  }
}

// Filters take dates as "yyyy-mm-dd hh:mm:ss +00:00".
export const dfsDate = (day: string) => `${day} 00:00:00 +00:00`;
