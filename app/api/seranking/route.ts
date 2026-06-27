import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";

const SE_RANKING_BASE = "https://api4.seranking.com";

async function serankingFetch(path: string, apiKey: string) {
  const res = await fetch(`${SE_RANKING_BASE}${path}`, {
    headers: { Authorization: `Token ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SE Ranking ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  const clientSlug = req.nextUrl.searchParams.get("client");
  if (!clientSlug) return NextResponse.json({ error: "Missing client" }, { status: 400 });

  const apiKey = process.env.SERANKING_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "SERANKING_API_KEY not set" }, { status: 503 });

  try {
    const clientConfig = await getClient(clientSlug);
    const srConfig = clientConfig?.integrations?.seRanking;
    if (!srConfig?.enabled) {
      return NextResponse.json({ error: "SE Ranking not enabled" }, { status: 404 });
    }
    const projectId = srConfig.projectId;
    if (!projectId) {
      return NextResponse.json({ error: "SE Ranking project ID not set" }, { status: 400 });
    }

    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    const todayStr = fmt(today);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const weekAgoStr = fmt(weekAgo);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
    const thirtyDaysAgoStr = fmt(thirtyDaysAgo);

    const [keywords, posToday, posWeekAgo, visHistory] = await Promise.all([
      serankingFetch(`/sites/${projectId}/keywords`, apiKey),
      serankingFetch(`/sites/${projectId}/positions?date=${todayStr}`, apiKey),
      serankingFetch(`/sites/${projectId}/positions?date=${weekAgoStr}`, apiKey),
      serankingFetch(`/sites/${projectId}/history?from=${thirtyDaysAgoStr}&to=${todayStr}`, apiKey),
    ]);

    const kwMap = new Map<string, string>();
    if (Array.isArray(keywords)) {
      for (const kw of keywords) {
        kwMap.set(String(kw.id), kw.keyword || kw.name || "");
      }
    }

    const todayMap = new Map<string, number>();
    const weekAgoMap = new Map<string, number>();

    if (Array.isArray(posToday)) {
      for (const p of posToday) {
        const pos = Number(p.position);
        if (pos > 0) todayMap.set(String(p.keyword_id ?? p.id), pos);
      }
    }
    if (Array.isArray(posWeekAgo)) {
      for (const p of posWeekAgo) {
        const pos = Number(p.position);
        if (pos > 0) weekAgoMap.set(String(p.keyword_id ?? p.id), pos);
      }
    }

    let movedUp = 0;
    let movedDown = 0;
    const kwDetails: { id: string; keyword: string; position: number; delta: number | null }[] = [];

    for (const [kwId, kwText] of kwMap) {
      const cur = todayMap.get(kwId);
      if (cur == null) continue;
      const prev = weekAgoMap.get(kwId);
      let delta: number | null = null;
      if (prev != null) {
        delta = prev - cur; // positive = better rank
        if (delta > 0) movedUp++;
        else if (delta < 0) movedDown++;
      }
      kwDetails.push({ id: kwId, keyword: kwText, position: cur, delta });
    }

    const top5 = kwDetails
      .filter((k) => k.position > 0 && k.position <= 100)
      .sort((a, b) => a.position - b.position)
      .slice(0, 5);

    const visibilityHistory = Array.isArray(visHistory)
      ? visHistory
          .filter((v: any) => v.date && v.visibility != null)
          .map((v: any) => ({ date: v.date as string, score: Number(v.visibility) }))
      : [];

    const currentVisibility =
      visibilityHistory.length > 0
        ? visibilityHistory[visibilityHistory.length - 1].score
        : null;

    return NextResponse.json({
      totalKeywords: kwMap.size,
      movedUp,
      movedDown,
      top5,
      currentVisibility,
      visibilityHistory,
    });
  } catch (err: any) {
    console.error("SE Ranking error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch SE Ranking data" },
      { status: 500 }
    );
  }
}
