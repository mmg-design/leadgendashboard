import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";

const SE_RANKING_BASE = "https://api.seranking.com";

async function serankingFetch(path: string, apiKey: string, params?: Record<string, string>) {
  let url = `${SE_RANKING_BASE}${path}`;
  if (params) {
    url += "?" + new URLSearchParams(params).toString();
  }
  const res = await fetch(url, {
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
    const weekAgoStr = fmt(new Date(today.getTime() - 8 * 86400000));
    const thirtyDaysAgoStr = fmt(new Date(today.getTime() - 30 * 86400000));

    const [keywords, positions, visHistory] = await Promise.all([
      serankingFetch("/v1/project-management/keywords", apiKey, { site_id: projectId }),
      serankingFetch("/v1/project-management/sites/positions", apiKey, {
        site_id: projectId,
        date_from: weekAgoStr,
        date_to: todayStr,
      }),
      serankingFetch("/v1/project-management/sites/positions/history", apiKey, {
        site_id: projectId,
        type: "visibility",
        date_from: thirtyDaysAgoStr,
        date_to: todayStr,
      }),
    ]);

    // Build keyword name map
    const kwMap = new Map<string, string>();
    if (Array.isArray(keywords)) {
      for (const kw of keywords) {
        kwMap.set(String(kw.id), kw.name || "");
      }
    }

    // Positions: array of {site_engine_id, keywords[{id, positions[{date,pos,change}]}]}
    // Use first (primary) search engine
    const positionsByKw = new Map<string, { latest: number; weekAgo: number | null }>();
    if (Array.isArray(positions) && positions.length > 0) {
      const engineData = positions[0];
      if (Array.isArray(engineData.keywords)) {
        for (const kwPos of engineData.keywords) {
          const posArr = kwPos.positions || [];
          const latestPos = Number(posArr[posArr.length - 1]?.pos ?? 0);
          const weekAgoPos = Number(posArr[0]?.pos ?? 0);
          positionsByKw.set(String(kwPos.id), {
            latest: latestPos,
            weekAgo: weekAgoPos > 0 ? weekAgoPos : null,
          });
        }
      }
    }

    let movedUp = 0;
    let movedDown = 0;
    const kwDetails: { id: string; keyword: string; position: number; delta: number | null }[] = [];

    for (const [kwId, kwText] of kwMap) {
      const posData = positionsByKw.get(kwId);
      if (!posData || posData.latest === 0) continue;
      const delta =
        posData.weekAgo != null ? posData.weekAgo - posData.latest : null;
      if (delta != null) {
        if (delta > 0) movedUp++;
        else if (delta < 0) movedDown++;
      }
      kwDetails.push({ id: kwId, keyword: kwText, position: posData.latest, delta });
    }

    const top5 = kwDetails
      .filter((k) => k.position > 0 && k.position <= 100)
      .sort((a, b) => a.position - b.position)
      .slice(0, 5);

    // Visibility history: array of {name, data:[{date,value}]} — take max across engines per date
    const visibilityMap = new Map<string, number>();
    if (Array.isArray(visHistory)) {
      for (const engine of visHistory) {
        for (const point of engine.data ?? []) {
          if (point.date) {
            visibilityMap.set(
              point.date,
              Math.max(visibilityMap.get(point.date) ?? 0, Number(point.value ?? 0))
            );
          }
        }
      }
    }

    const visibilityHistory = Array.from(visibilityMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, score]) => ({ date, score }));

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
