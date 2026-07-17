import { NextRequest, NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getClient } from "@/lib/clients";
import fs from "fs";
import path from "path";

type NamedRange = { start: string; end: string };

function analyticsClient() {
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString());
    return new BetaAnalyticsDataClient({ credentials });
  }
  const keyFilename = path.join(process.cwd(), "web-lead-gen-mvp-97217b4d6543.json");
  if (fs.existsSync(keyFilename)) return new BetaAnalyticsDataClient({ keyFilename });
  throw new Error("Google Analytics credentials are not configured");
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
}

function rangeRow(report: { rows?: Array<{ dimensionValues?: Array<{ value?: string | null }> | null; metricValues?: Array<{ value?: string | null }> | null }> | null }, name: string) {
  return report.rows?.find((row) => row.dimensionValues?.some((value) => value.value === name));
}

function metricNumber(row: ReturnType<typeof rangeRow>, index: number) {
  return Number(row?.metricValues?.[index]?.value || 0);
}

async function fetchGa(propertyId: string, pre: NamedRange, post: NamedRange) {
  const client = analyticsClient();
  const dateRanges = [
    { startDate: pre.start, endDate: pre.end, name: "pre" },
    { startDate: post.start, endDate: post.end, name: "post" },
  ];
  const [summaryResponse, dailyResponse, sourcesResponse, pagesResponse, dailyPagesResponse] = await Promise.all([
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges,
      metrics: [
        { name: "sessions" }, { name: "screenPageViews" }, { name: "activeUsers" },
        { name: "engagedSessions" }, { name: "engagementRate" }, { name: "bounceRate" },
        { name: "averageSessionDuration" }, { name: "eventCount" },
      ],
    }),
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "engagedSessions" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 10000,
    }),
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 40,
    }),
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "engagementRate" }, { name: "averageSessionDuration" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 50,
    }),
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges,
      dimensions: [{ name: "date" }, { name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" } }, { metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10000,
    }),
  ]);
  const summary = summaryResponse[0];
  const summarize = (name: string) => {
    const row = rangeRow(summary, name);
    return {
      sessions: metricNumber(row, 0), pageviews: metricNumber(row, 1), users: metricNumber(row, 2),
      engagedSessions: metricNumber(row, 3), engagementRate: metricNumber(row, 4), bounceRate: metricNumber(row, 5),
      averageSessionDuration: metricNumber(row, 6), events: metricNumber(row, 7),
    };
  };
  const preSummary = summarize("pre");
  const postSummary = summarize("post");
  const mapRows = (report: typeof dailyResponse[0], mapper: (row: NonNullable<typeof report.rows>[number], range: string) => unknown) => {
    const rangeIndex = report.dimensionHeaders?.findIndex((header) => header.name === "dateRange") ?? 0;
    return (report.rows || []).map((row) => mapper(row, row.dimensionValues?.[rangeIndex]?.value || "unknown"));
  };
  const dailyTopPages = new Map<string, Array<{ page: string; views: number }>>();
  mapRows(dailyPagesResponse[0], (row, range) => {
    const headers = dailyPagesResponse[0].dimensionHeaders || [];
    const dateIndex = headers.findIndex((header) => header.name === "date");
    const pageIndex = headers.findIndex((header) => header.name === "pagePath");
    const raw = row.dimensionValues?.[dateIndex]?.value || "";
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const key = `${range}:${date}`;
    const list = dailyTopPages.get(key) || [];
    const views = Number(row.metricValues?.[0]?.value || 0);
    if (views > 0 && list.length < 3) list.push({ page: row.dimensionValues?.[pageIndex]?.value || "/", views });
    dailyTopPages.set(key, list);
    return null;
  });
  const daily = mapRows(dailyResponse[0], (row, range) => {
    const headers = dailyResponse[0].dimensionHeaders || [];
    const dateIndex = headers.findIndex((header) => header.name === "date");
    const raw = row.dimensionValues?.[dateIndex]?.value || "";
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return { range, date, sessions: Number(row.metricValues?.[0]?.value || 0), pageviews: Number(row.metricValues?.[1]?.value || 0), engagedSessions: Number(row.metricValues?.[2]?.value || 0), topPages: dailyTopPages.get(`${range}:${date}`) || [] };
  }).filter((point) => {
    const item = point as { range: string; date: string };
    return item.range === "pre" ? item.date >= pre.start && item.date <= pre.end : item.range === "post" ? item.date >= post.start && item.date <= post.end : false;
  });
  const grouped = (report: typeof sourcesResponse[0], label: string) => mapRows(report, (row, range) => {
    const headers = report.dimensionHeaders || [];
    const labelIndex = headers.findIndex((header) => header.name !== "dateRange");
    return { range, [label]: row.dimensionValues?.[labelIndex]?.value || "(unknown)", values: row.metricValues?.map((value) => Number(value.value || 0)) || [] };
  }).filter((item) => (item as { values: number[] }).values.some((value) => value !== 0));
  return {
    summary: { pre: preSummary, post: postSummary, changes: Object.fromEntries(Object.keys(preSummary).map((key) => [key, percentChange(postSummary[key as keyof typeof postSummary], preSummary[key as keyof typeof preSummary])])) },
    daily,
    channels: grouped(sourcesResponse[0], "channel"),
    pages: grouped(pagesResponse[0], "page"),
  };
}

async function seFetch(endpoint: string, params: Record<string, string>) {
  const apiKey = process.env.SERANKING_API_KEY;
  if (!apiKey) throw new Error("SE Ranking API key is not configured");
  const response = await fetch(`https://api.seranking.com${endpoint}?${new URLSearchParams(params)}`, { headers: { Authorization: `Token ${apiKey}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`SE Ranking returned ${response.status}`);
  return response.json();
}

async function fetchSeRanking(projectId: string, pre: NamedRange, post: NamedRange) {
  const dateFrom = pre.start < post.start ? pre.start : post.start;
  const dateTo = pre.end > post.end ? pre.end : post.end;
  const [keywords, positions, visibility] = await Promise.all([
    seFetch("/v1/project-management/keywords", { site_id: projectId }),
    seFetch("/v1/project-management/sites/positions", { site_id: projectId, date_from: dateFrom, date_to: dateTo }),
    seFetch("/v1/project-management/sites/positions/history", { site_id: projectId, type: "visibility", date_from: dateFrom, date_to: dateTo }),
  ]);
  const names = new Map<string, string>((Array.isArray(keywords) ? keywords : []).map((keyword: { id: string | number; name?: string }) => [String(keyword.id), keyword.name || ""]));
  const engine = Array.isArray(positions) ? positions[0] : null;
  const keywordHistory = (engine?.keywords || []).map((keyword: { id: string | number; positions?: Array<{ date: string; pos: string | number }> }) => ({
    id: String(keyword.id), keyword: names.get(String(keyword.id)) || "", positions: keyword.positions || [],
  }));
  const snapshot = (end: string) => keywordHistory.map((keyword: { id: string; keyword: string; positions: Array<{ date: string; pos: string | number }> }) => {
    const eligible = keyword.positions.filter((point) => point.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    return { id: keyword.id, keyword: keyword.keyword, position: Number(eligible.at(-1)?.pos || 0) };
  });
  const summarize = (items: Array<{ position: number }>) => {
    const ranked = items.filter((item) => item.position > 0);
    return { trackedKeywords: items.length, rankedKeywords: ranked.length, top3: ranked.filter((item) => item.position <= 3).length, top10: ranked.filter((item) => item.position <= 10).length, top30: ranked.filter((item) => item.position <= 30).length, averagePosition: ranked.length ? Math.round((ranked.reduce((sum, item) => sum + item.position, 0) / ranked.length) * 10) / 10 : null };
  };
  const visibilityMap = new Map<string, number>();
  for (const searchEngine of Array.isArray(visibility) ? visibility : []) for (const point of searchEngine.data || []) visibilityMap.set(point.date, Math.max(visibilityMap.get(point.date) || 0, Number(point.value || 0)));
  const visibilityHistory = [...visibilityMap].sort((a, b) => a[0].localeCompare(b[0])).map(([date, score]) => ({ date, score, range: date >= post.start && date <= post.end ? "post" : date >= pre.start && date <= pre.end ? "pre" : "outside" }));
  const preSnapshot = snapshot(pre.end);
  const postSnapshot = snapshot(post.end);
  return { summary: { pre: summarize(preSnapshot), post: summarize(postSnapshot) }, visibilityHistory, keywordSnapshots: { pre: preSnapshot, post: postSnapshot } };
}

async function fetchClarity(projectId: string) {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) throw new Error("Clarity API token is not configured");
  const response = await fetch("https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3", { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Clarity returned ${response.status}`);
  return { projectId, window: "rolling last 72 hours only", comparable: false, metrics: await response.json() };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clientSlug, pre: requestedPre, post: requestedPost, range, mode = "comparison", query, sources, output = "report" } = body as { clientSlug?: string; pre?: NamedRange; post?: NamedRange; range?: NamedRange; mode?: "comparison" | "single" | "prompt-only"; query?: string; sources?: string[]; output?: "report" | "prompt" };
    if (!clientSlug) return NextResponse.json({ error: "Client is required" }, { status: 400 });
    const config = await getClient(clientSlug);
    if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (mode === "prompt-only") {
      const prompt = `You are a senior web analytics and SEO strategist working on ${config.name}.\n\nUser request:\n${query || "Analyze the client's performance and provide evidence-based recommendations."}\n\nUse any source data supplied with this prompt. Do not invent metrics or claim causation without evidence. Clearly identify missing information, state assumptions, cite the metric behind each conclusion, and provide practical next steps.`;
      return NextResponse.json({ prompt, data: {}, availability: {}, limitations: ["Prompt-only mode does not pull client analytics data."] });
    }
    const pre = mode === "single" ? range : requestedPre;
    const post = mode === "single" ? range : requestedPost;
    if (!pre || !post || !validDate(pre.start) || !validDate(pre.end) || !validDate(post.start) || !validDate(post.end)) return NextResponse.json({ error: mode === "single" ? "A valid start and end date are required" : "Valid pre/post dates are required" }, { status: 400 });
    if (pre.start > pre.end || post.start > post.end) return NextResponse.json({ error: "Each start date must be on or before its end date" }, { status: 400 });
    const selected = new Set(sources?.length ? sources : ["ga", "clarity", "seranking"]);
    const today = new Date().toISOString().slice(0, 10);
    const effectivePost = { ...post, end: post.end > today ? today : post.end };
    const limitations: string[] = [];
    if (post.end > today) limitations.push(`Post-launch data is incomplete: ${post.end} is in the future; data currently ends ${today}.`);
    const data: Record<string, unknown> = {};
    const availability: Record<string, string> = {};
    const jobs: Promise<void>[] = [];
    if (selected.has("ga")) {
      const integration = config.integrations.googleAnalytics;
      if (integration?.enabled && integration.propertyId) jobs.push(fetchGa(integration.propertyId, pre, effectivePost).then((value) => { data.ga = value; availability.ga = "available"; }).catch((error) => { availability.ga = error.message; }));
      else availability.ga = "not configured";
    }
    if (selected.has("seranking")) {
      const integration = config.integrations.seRanking;
      if (integration?.enabled && integration.projectId) jobs.push(fetchSeRanking(integration.projectId, pre, effectivePost).then((value) => { data.seranking = value; availability.seranking = "available"; }).catch((error) => { availability.seranking = error.message; }));
      else availability.seranking = "not configured";
    }
    if (selected.has("clarity")) {
      const integration = config.integrations.clarity;
      limitations.push("Microsoft Clarity Data Export supplies only the most recent 72 hours, not arbitrary historical pre/post ranges; it is included as current context only.");
      if (integration?.enabled && integration.projectId) jobs.push(fetchClarity(integration.projectId).then((value) => { data.clarity = value; availability.clarity = "current context only"; }).catch((error) => { availability.clarity = error.message; }));
      else availability.clarity = "not configured";
    }
    await Promise.all(jobs);
    if (mode === "single") {
      const ga = data.ga as { summary?: { post?: unknown }; daily?: Array<{ range: string }> } | undefined;
      if (ga?.summary) ga.summary = { single: ga.summary.post } as typeof ga.summary;
      if (ga?.daily) ga.daily = ga.daily.filter((point) => point.range === "post").map((point) => ({ ...point, range: "single" }));
      const se = data.seranking as { summary?: { post?: unknown }; visibilityHistory?: Array<{ range: string }> } | undefined;
      if (se?.summary) se.summary = { single: se.summary.post } as typeof se.summary;
      if (se?.visibilityHistory) se.visibilityHistory = se.visibilityHistory.filter((point) => point.range === "post").map((point) => ({ ...point, range: "single" }));
    }
    const periodContext = mode === "single"
      ? `Analysis period: ${pre.start} through ${effectivePost.end}`
      : `Pre period: ${pre.start} through ${pre.end}\nPost period requested: ${post.start} through ${post.end}\nPost period available: ${effectivePost.start} through ${effectivePost.end}`;
    const prompt = `You are a senior web analytics and SEO strategist. Produce an evidence-based ${mode === "single" ? "period analysis" : "comparative report"} for ${config.name}.\n\nUser request:\n${query || (mode === "single" ? "Analyze performance during this period." : "Compare the pre and post periods and explain material changes.")}\n\n${periodContext}\n\nAvailability: ${JSON.stringify(availability, null, 2)}\nLimitations: ${limitations.join(" ") || "None"}\n\nStructured source data:\n${JSON.stringify(data, null, 2)}\n\nRules: Do not invent data. Distinguish correlation from causation. Cite the exact metric and period behind every conclusion. Call out incomplete or unavailable sources. Cover traffic, engagement, acquisition channels, content/pages, SEO visibility, keyword distribution, and actionable next steps when supported.`;
    const effectiveRanges = mode === "single" ? { range: { start: pre.start, end: effectivePost.end } } : { pre, post: effectivePost };
    if (output === "prompt") return NextResponse.json({ prompt, data, availability, limitations, effectiveRanges });
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: "GEMINI_API_KEY is not configured", prompt, data, availability, limitations }, { status: 503 });
    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(`${prompt}\n\nReturn raw JSON only, with no markdown fences, using this exact shape:\n{"sections":[{"key":"executive|kpi|traffic|engagement|search|clarity","title":"Section title","summary":"One short plain-English takeaway","insights":[{"label":"Short label","value":"Metric or finding","explanation":"One sentence at a sixth-grade reading level"}]}],"beforeAfter":{"before":{"title":"Before","points":["Only the important starting conditions"]},"after":{"title":"After","points":["Only the important ending conditions"]},"differentiators":["Only material differences"]},"recommendations":[{"title":"Action title","action":"Specific next step","why":"Metric-based reason"}],"context":["Detailed supporting fact or limitation"]}. Include exactly six section cards: Executive Summary, KPI Comparison, Traffic and Acquisition, Engagement and Content, Search Visibility and Rankings, and Clarity Context. Keep each summary under 35 words, each section to 2-4 insights, and explanations simple. Do not repeat the same metric across sections.`);
    const reportText = result.response.text().trim().replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
    const report = JSON.parse(reportText);
    return NextResponse.json({ report, prompt, data, availability, limitations, effectiveRanges });
  } catch (error) {
    console.error("Custom report error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate report" }, { status: 500 });
  }
}
