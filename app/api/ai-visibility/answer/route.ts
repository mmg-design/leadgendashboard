import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";
import { getAnswer } from "@/lib/airt";

// One engine's cached answer to one prompt on one day: the text, the brands it
// named in order, and the sources it cited. Free in SE Ranking; text is kept 30 days.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const slug = p.get("client");
  const llmId = Number(p.get("llm"));
  const promptLlmId = Number(p.get("promptLlmId"));
  const date = p.get("date") || new Date().toISOString().slice(0, 10);
  if (!slug || !llmId || !promptLlmId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const config = await getClient(slug);
  const siteId = config?.integrations.seRanking?.enabled ? config.integrations.seRanking.projectId : "";
  if (!siteId) return NextResponse.json({ error: "SE Ranking not connected" }, { status: 400 });

  const key = `${llmId}:${promptLlmId}:${date}`;
  const db = await getDb();
  const cached = await db.execute({
    sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'ai_answer' AND date_range = ?`,
    args: [slug, key],
  });
  if (cached.rows.length > 0) return NextResponse.json(JSON.parse(cached.rows[0].data as string));

  try {
    const answer = await getAnswer(siteId, llmId, promptLlmId, date);
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'ai_answer', ?, ?, datetime('now'))`,
      args: [slug, key, JSON.stringify(answer)],
    });
    return NextResponse.json(answer);
  } catch (err) {
    console.error("AI answer error:", err);
    return NextResponse.json({ error: "That answer isn't available (SE Ranking keeps answer text for 30 days)." }, { status: 404 });
  }
}
