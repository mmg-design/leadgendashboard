import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";
import { getAiVisibility } from "@/lib/airt";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
const CACHE_HOURS = 6; // AI engines are checked once a day

// How ChatGPT, Perplexity, Gemini, and Google's AI features answer the client's
// tracked prompts (SE Ranking AI Result Tracker).
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const range = req.nextUrl.searchParams.get("range") || "30d";
  const fresh = req.nextUrl.searchParams.has("_t");
  if (!slug) return NextResponse.json({ error: "Missing client param" }, { status: 400 });

  const config = await getClient(slug);
  const siteId = config?.integrations.seRanking?.enabled ? config.integrations.seRanking.projectId : "";
  if (!config || !siteId) {
    return NextResponse.json({ status: "no_seranking", message: "Connect SE Ranking in Settings to track AI search visibility." });
  }

  const db = await getDb();
  if (!fresh) {
    const cached = await db.execute({
      sql: `SELECT data FROM analytics_cache WHERE client_slug = ? AND metric_type = 'ai_visibility' AND date_range = ?
            AND fetched_at > datetime('now', ?)`,
      args: [slug, range, `-${CACHE_HOURS} hours`],
    });
    if (cached.rows.length > 0) return NextResponse.json(JSON.parse(cached.rows[0].data as string));
  }

  try {
    const data = await getAiVisibility(siteId, RANGE_DAYS[range] || 30, config.domain);
    // Don't cache "not set up": the answer changes as soon as someone sets it up.
    if (data.status !== "not_set_up") {
      await db.execute({
        sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
              VALUES (?, 'ai_visibility', ?, ?, datetime('now'))`,
        args: [slug, range, JSON.stringify(data)],
      });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("AI visibility error:", err);
    return NextResponse.json({ status: "error", message: "Couldn't load AI visibility from SE Ranking." });
  }
}
