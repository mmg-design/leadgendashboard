import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";

// AI keyword ideas for one page, shown in the Top Pages hover card. Requested
// on hover, so results are cached per page for a week to keep Gemini calls
// (and the wait) to the first hover.

const CACHE_DAYS = 7;

interface Suggestion {
  keyword: string;
  why: string;
}

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  const { client, page, ranking = [], tracked = [] } = (await req.json()) as {
    client?: string;
    page?: string;
    ranking?: { keyword: string; position: number }[];
    tracked?: string[];
  };
  if (!client || !page) {
    return NextResponse.json({ error: "Missing client or page" }, { status: 400 });
  }

  const config = await getClient(client);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const db = await getDb();
  const cached = await db.execute({
    sql: `SELECT data FROM analytics_cache
          WHERE client_slug = ? AND metric_type = 'kw_suggest' AND date_range = ?
          AND fetched_at > datetime('now', ?)`,
    args: [client, page, `-${CACHE_DAYS} days`],
  });
  if (cached.rows.length > 0) {
    return NextResponse.json({ suggestions: JSON.parse(cached.rows[0].data as string) });
  }

  const prompt = `You are an SEO strategist for ${config.name} (${config.domain}).
Suggest 3 search keywords that the page ${config.domain}${page} should target.

What this page already ranks for in Google (keyword: position):
${ranking.length ? ranking.map((r) => `- ${r.keyword}: #${r.position}`).join("\n") : "- nothing in the top 100 yet"}

Keywords the client already tracks (do NOT repeat these, suggest new ones):
${tracked.slice(0, 60).map((t) => `- ${t}`).join("\n") || "- none"}

Rules:
- Judge the page's topic from its URL path and the keywords above. Don't invent services the business doesn't offer.
- Prefer specific, realistic phrases a buyer would type (3-6 words) over broad head terms.
- Give each a one-sentence reason in plain language, no jargon, no em dashes.
- Return JSON only: {"suggestions":[{"keyword":"...","why":"..."}]}`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // A response schema makes Gemini return well-formed JSON; one retry covers
    // the rare reply that still doesn't parse.
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            suggestions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: { keyword: { type: SchemaType.STRING }, why: { type: SchemaType.STRING } },
                required: ["keyword", "why"],
              },
            },
          },
          required: ["suggestions"],
        },
      },
    });
    let parsed: { suggestions?: Suggestion[] } | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const result = await model.generateContent(prompt);
      try {
        parsed = JSON.parse(result.response.text());
      } catch {
        if (attempt === 1) throw new Error("Gemini returned malformed JSON twice");
      }
    }
    if (!parsed) throw new Error("No suggestions returned");
    const suggestions = (parsed.suggestions || [])
      .filter((s) => s && typeof s.keyword === "string" && typeof s.why === "string")
      .map((s) => ({ keyword: s.keyword.trim(), why: s.why.trim() }))
      .slice(0, 3);

    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'kw_suggest', ?, ?, datetime('now'))`,
      args: [client, page, JSON.stringify(suggestions)],
    });
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("Keyword suggestion error:", err);
    return NextResponse.json({ error: "Couldn't generate suggestions" }, { status: 500 });
  }
}
