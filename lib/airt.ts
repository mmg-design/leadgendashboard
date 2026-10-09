// SE Ranking AI Result Tracker: how ChatGPT, Perplexity, Gemini, and Google's
// AI features answer the prompts we track for a client. All reads are free
// (0 credits); setup consumes the account's AI tracking allowance.
//
// Rankings `positions[].mention_position`: >0 = the brand was named at that
// position, 0 = an answer existed without the brand, null = no AI answer that
// day (not the same as "not mentioned").

const BASE = "https://api.seranking.com/v1/project-management";

export const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  google_ai_overview: "Google AI Overview",
  google_ai_mode: "Google AI Mode",
};

export const ENGINE_ORDER = ["chatgpt", "google_ai_overview", "perplexity", "gemini", "google_ai_mode"];

function apiKey() {
  const key = process.env.SERANKING_API_KEY;
  if (!key) throw new Error("SERANKING_API_KEY not set");
  return key;
}

async function sr<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method || "GET",
    headers: { Authorization: `Token ${apiKey()}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SE Ranking ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// Prompt endpoints allow 5 requests/second; run a few at a time.
async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

// ── Raw shapes (only the fields we use) ─────────────────────────────────────

interface RawEngine { id: number; base_name: string; country_code: string; region_name?: string | null }
interface RawPrompt { prompt_llm_id: string; prompt_id: string; prompt: string }
interface RawPosition { date: string; url_position: number | null; mention_position: number | null; mentions_count: number | null }
interface RawRanking { prompt_id: string | number; prompt: string; search_volume: number | null; search_intent: string[] | null; positions: RawPosition[] }
interface RawStats {
  stats?: { prompts_count?: number; last_update?: string };
  presence?: { link_percent_in_top?: number; link_diff?: string | number; mention_percent_in_top?: number; mention_diff?: string | number };
}

// ── Output ──────────────────────────────────────────────────────────────────

export interface AiEngine {
  id: number;
  key: string;
  name: string;
  mentionPct: number | null;
  mentionDiff: number | null;
  linkPct: number | null;
  linkDiff: number | null;
  promptsCount: number;
  lastUpdate: string | null;
}

export interface AiPromptResult {
  promptLlmId: number | null;
  mentionPosition: number | null; // >0 named at this position, 0 answered without the brand, null no answer
  mentionsCount: number | null; // brands named in the answer
  linked: boolean;
  date: string | null;
}

export interface AiPrompt {
  promptId: string;
  prompt: string;
  intent: string[];
  byEngine: Record<number, AiPromptResult>;
}

export interface AiCompetitor { name: string; inAnswers: number; inSources: number; isYou: boolean }

export interface AiSourceDomain {
  domain: string;
  aiAnswers: number;
  prompts: number;
  mentionsYou: boolean;
  mentionRatePct: number;
  domainTrust: number | null;
  isYou: boolean;
}

export interface AiVisibility {
  status: "ok" | "collecting" | "not_set_up";
  brand: string | null;
  dateFrom: string;
  dateTo: string;
  engines: AiEngine[];
  prompts: AiPrompt[];
  competitors: AiCompetitor[];
  sources: AiSourceDomain[];
  opportunities: { mentionOpportunities: number; competitorOnlyMentions: number; mentionsWithoutBacklinks: number } | null;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export async function getBrand(siteId: string): Promise<string | null> {
  const data = await sr<{ brand?: string }>(`/airt/brand?site_id=${siteId}`).catch(() => null);
  return data?.brand || null;
}

export async function getAiVisibility(siteId: string, days: number, clientDomain: string): Promise<AiVisibility> {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  const dateFrom = fmt(from);
  const dateTo = fmt(to);

  const [rawEngines, brand] = await Promise.all([
    sr<RawEngine[]>(`/airt/llm?site_id=${siteId}`),
    getBrand(siteId),
  ]);
  const enginesList = (rawEngines || []).sort(
    (a, b) => ENGINE_ORDER.indexOf(a.base_name) - ENGINE_ORDER.indexOf(b.base_name)
  );
  if (enginesList.length === 0) {
    return { status: "not_set_up", brand, dateFrom, dateTo, engines: [], prompts: [], competitors: [], sources: [], opportunities: null };
  }

  const perEngine = await inBatches(enginesList, 2, async (e) => {
    const q = `site_id=${siteId}&llm_id=${e.id}`;
    const [stats, rankings, prompts] = await Promise.all([
      sr<RawStats>(`/airt/llm/statistics?${q}&from=${dateFrom}&to=${dateTo}`).catch(() => null),
      sr<{ items?: RawRanking[] }>(`/airt/prompts/rankings?${q}&date_from=${dateFrom}&date_to=${dateTo}&limit=200`).catch(() => null),
      sr<{ items?: RawPrompt[] }>(`/airt/prompts?${q}&limit=1000`).catch(() => null),
    ]);
    return { e, stats, rankings: rankings?.items || [], prompts: prompts?.items || [] };
  });

  const engines: AiEngine[] = perEngine.map(({ e, stats }) => ({
    id: e.id,
    key: e.base_name,
    name: ENGINE_LABELS[e.base_name] || e.base_name,
    mentionPct: num(stats?.presence?.mention_percent_in_top),
    mentionDiff: num(stats?.presence?.mention_diff),
    linkPct: num(stats?.presence?.link_percent_in_top),
    linkDiff: num(stats?.presence?.link_diff),
    promptsCount: Number(stats?.stats?.prompts_count || 0),
    lastUpdate: stats?.stats?.last_update || null,
  }));

  // One row per prompt, newest answered day per engine. Each engine's copy of a
  // prompt has its own prompt_id, so rows are joined on the prompt text.
  const prompts = new Map<string, AiPrompt>();
  for (const { e, rankings, prompts: list } of perEngine) {
    const llmIdByPrompt = new Map(list.map((p) => [String(p.prompt_id), Number(p.prompt_llm_id)]));
    for (const r of rankings) {
      const id = String(r.prompt_id);
      const textKey = r.prompt.trim().toLowerCase();
      let row = prompts.get(textKey);
      if (!row) {
        row = { promptId: id, prompt: r.prompt, intent: r.search_intent || [], byEngine: {} };
        prompts.set(textKey, row);
      }
      const latest = [...(r.positions || [])].reverse().find((p) => p.mention_position !== null);
      row.byEngine[e.id] = {
        promptLlmId: llmIdByPrompt.get(id) ?? null,
        mentionPosition: latest ? num(latest.mention_position) : null,
        mentionsCount: latest ? num(latest.mentions_count) : null,
        linked: !!latest && Number(latest.url_position) > 0,
        date: latest?.date || null,
      };
    }
  }

  const [summary, domains] = await Promise.all([
    sr<{
      summary?: { mention_opportunities?: number; competitor_only_mentions?: number; mentions_without_backlinks?: number };
      competitors?: { name: string; count_in_ai_answers: number; count_in_sources: number }[];
    }>(`/airt/sources/summary?site_id=${siteId}&date_from=${dateFrom}&date_to=${dateTo}`).catch(() => null),
    sr<{
      items?: { domain: string; ai_answers_total: number | string; prompts_total: number | string; brand_mentions_total: number | string; mention_rate_percent: number | string; dt: number | string | null }[];
    }>(`/airt/sources/domains?site_id=${siteId}&date_from=${dateFrom}&date_to=${dateTo}&limit=12`).catch(() => null),
  ]);

  const brandLower = (brand || "").toLowerCase();
  const ownDomain = clientDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

  const competitors: AiCompetitor[] = (summary?.competitors || [])
    .map((c) => ({
      name: c.name,
      inAnswers: Number(c.count_in_ai_answers) || 0,
      inSources: Number(c.count_in_sources) || 0,
      isYou: !!brandLower && c.name.toLowerCase() === brandLower,
    }))
    .sort((a, b) => b.inAnswers - a.inAnswers);

  const sources: AiSourceDomain[] = (domains?.items || []).map((d) => {
    const domain = d.domain.toLowerCase().replace(/^www\./, "");
    return {
      domain,
      aiAnswers: Number(d.ai_answers_total) || 0,
      prompts: Number(d.prompts_total) || 0,
      mentionsYou: Number(d.brand_mentions_total) > 0,
      mentionRatePct: Number(d.mention_rate_percent) || 0,
      domainTrust: num(d.dt),
      isYou: domain === ownDomain,
    };
  });

  const hasData = [...prompts.values()].some((p) => Object.values(p.byEngine).some((r) => r.date));
  return {
    status: hasData ? "ok" : "collecting",
    brand,
    dateFrom,
    dateTo,
    engines,
    prompts: [...prompts.values()],
    competitors,
    sources,
    opportunities: summary?.summary
      ? {
          mentionOpportunities: Number(summary.summary.mention_opportunities) || 0,
          competitorOnlyMentions: Number(summary.summary.competitor_only_mentions) || 0,
          mentionsWithoutBacklinks: Number(summary.summary.mentions_without_backlinks) || 0,
        }
      : null,
  };
}

export interface AiAnswer {
  date: string;
  text: string;
  brands: { name: string; position: number }[];
  sources: { url: string; position: number }[];
}

export async function getAnswer(siteId: string, llmId: number, promptLlmId: number, date: string): Promise<AiAnswer> {
  const a = await sr<{ date: string; text?: string; brands?: { name: string; position: number }[]; sources?: { url: string; position: number }[] }>(
    `/airt/prompts/answer?site_id=${siteId}&llm_id=${llmId}&prompt_llm_id=${promptLlmId}&date=${date}`
  );
  return {
    date: a.date,
    // Answers open with an engine label ("ChatGPT said:", "AI Mode reply for <prompt>");
    // the card already shows the engine and prompt.
    text: (a.text || "")
      .replace(/^\s*(?:[\w ]{1,25} said:|[\w ]{1,25} reply for[^\n]*)\s*/i, "")
      // Scraped answers carry leftover interface labels (map controls, buttons).
      .split("\n")
      .filter((line) => !/^(reset view( expand map)?|expand map|map\W*|show (more|less|all)|copy|share|sources?)$/i.test(line.trim().replace(/\s+/g, " ")))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    brands: (a.brands || []).sort((x, y) => x.position - y.position),
    sources: (a.sources || []).sort((x, y) => x.position - y.position),
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────

export async function setUpTracking(siteId: string, opts: {
  brand: string;
  engines: string[];
  prompts: string[];
  countryCode?: string;
  langCode?: string;
}): Promise<{ engines: number; promptsAdded: number }> {
  const existingBrand = await getBrand(siteId);
  if (!existingBrand) {
    await sr(`/airt/brand?site_id=${siteId}`, { method: "POST", body: { brand: opts.brand.slice(0, 255) } });
  }

  const existing = await sr<RawEngine[]>(`/airt/llm?site_id=${siteId}`);
  const prompts = [...new Set(opts.prompts.map((p) => p.trim()).filter((p) => p && p.length <= 255))];
  let promptsAdded = 0;
  let engines = 0;
  for (const baseName of opts.engines.filter((e) => ENGINE_LABELS[e])) {
    let engine = existing.find((e) => e.base_name === baseName);
    if (!engine) {
      engine = await sr<RawEngine>(`/airt/llm?site_id=${siteId}`, {
        method: "POST",
        body: { base_name: baseName, country_code: opts.countryCode || "us", lang_code: opts.langCode || "en" },
      });
    }
    engines++;
    if (prompts.length) {
      const added = await sr<{ added?: number }>(`/airt/prompts?site_id=${siteId}&llm_id=${engine.id}`, {
        method: "POST",
        body: { prompts },
      });
      promptsAdded += Number(added.added) || 0;
    }
  }
  return { engines, promptsAdded };
}
