import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";

const SE_RANKING_BASE = "https://api.seranking.com";

async function serankingFetch(path: string, apiKey: string, params?: Record<string, string>, fresh = false) {
  let url = `${SE_RANKING_BASE}${path}`;
  if (params) {
    url += "?" + new URLSearchParams(params).toString();
  }
  const res = await fetch(url, {
    headers: { Authorization: `Token ${apiKey}` },
    ...(fresh ? { cache: "no-store" } : { next: { revalidate: 3600 } }),
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

  const fresh = req.nextUrl.searchParams.has("_t");

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
    const sevenDaysAgoStr = fmt(new Date(today.getTime() - 7 * 86400000));
    const monthStartStr = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
    const thirtyDaysAgoStr = fmt(new Date(today.getTime() - 30 * 86400000));

    const [keywords, positions, visHistory, aiPositions] = await Promise.all([
      serankingFetch("/v1/project-management/keywords", apiKey, { site_id: projectId }, fresh),
      serankingFetch("/v1/project-management/sites/positions", apiKey, {
        site_id: projectId,
        date_from: monthStartStr,
        date_to: todayStr,
      }, fresh),
      serankingFetch("/v1/project-management/sites/positions/history", apiKey, {
        site_id: projectId,
        type: "visibility",
        date_from: thirtyDaysAgoStr,
        date_to: todayStr,
      }, fresh),
      serankingFetch("/v1/project-management/sites/positions", apiKey, {
        site_id: projectId,
        type: "ai_overview",
        date_from: todayStr,
        date_to: todayStr,
      }, fresh),
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
    const positionsByKw = new Map<string, { latest: number; weekAgo: number | null; monthStart: number }>();
    if (Array.isArray(positions) && positions.length > 0) {
      const engineData = positions[0];
      if (Array.isArray(engineData.keywords)) {
        for (const kwPos of engineData.keywords) {
          const posArr: { date: string; pos: string | number }[] = kwPos.positions || [];
          const latestPos = Number(posArr[posArr.length - 1]?.pos ?? 0);
          // Find 7-days-ago by date match for accurate delta
          const weekAgoEntry = posArr.find((p) => p.date === sevenDaysAgoStr);
          const weekAgoPos = weekAgoEntry
            ? Number(weekAgoEntry.pos ?? 0)
            : Number(posArr[0]?.pos ?? 0);
          // Month-start position for "new rankings this month"
          const monthStartPos = Number(posArr[0]?.pos ?? 0);
          positionsByKw.set(String(kwPos.id), {
            latest: latestPos,
            weekAgo: weekAgoPos > 0 ? weekAgoPos : null,
            monthStart: monthStartPos,
          });
        }
      }
    }

    let movedUp = 0;
    let movedDown = 0;
    let top10Count = 0;
    let avgPosSum = 0;
    let avgPosCount = 0;
    let newRankingsThisMonth = 0;
    const kwDetails: { id: string; keyword: string; position: number; delta: number | null }[] = [];

    for (const [kwId, kwText] of kwMap) {
      const posData = positionsByKw.get(kwId);
      const latest = posData?.latest ?? 0;
      const weekAgo = posData?.weekAgo ?? null;
      const monthStart = posData?.monthStart ?? 0;
      const delta = weekAgo != null && latest > 0 ? weekAgo - latest : null;
      if (delta != null) {
        if (delta > 0) movedUp++;
        else if (delta < 0) movedDown++;
      }
      if (latest > 0 && latest <= 10) top10Count++;
      if (latest > 0) { avgPosSum += latest; avgPosCount++; }
      if (monthStart === 0 && latest > 0) newRankingsThisMonth++;
      kwDetails.push({ id: kwId, keyword: kwText, position: latest, delta });
    }

    const averagePosition = avgPosCount > 0
      ? Math.round((avgPosSum / avgPosCount) * 10) / 10
      : null;

    // Sort: ranked first (ascending position), then unranked alphabetically
    const allKeywords = kwDetails.sort((a, b) => {
      if (a.position > 0 && b.position > 0) return a.position - b.position;
      if (a.position > 0) return -1;
      if (b.position > 0) return 1;
      return a.keyword.localeCompare(b.keyword);
    });

    const top5 = allKeywords.filter((k) => k.position > 0).slice(0, 5);

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

    // AI Overview visibility: % of keywords appearing in Google AI Overviews
    let aiOverviewCount = 0;
    const totalTracked = kwMap.size;
    if (Array.isArray(aiPositions) && aiPositions.length > 0) {
      const aiEngine = aiPositions[0];
      if (Array.isArray(aiEngine.keywords)) {
        for (const kwPos of aiEngine.keywords) {
          const positions = kwPos.positions ?? [];
          const latest = Number(positions[positions.length - 1]?.pos ?? 0);
          if (latest > 0) aiOverviewCount++;
        }
      }
    }
    const aiVisibilityScore: number | null =
      totalTracked > 0 ? Math.round((aiOverviewCount / totalTracked) * 100) : null;

    return NextResponse.json({
      totalKeywords: kwMap.size,
      movedUp,
      movedDown,
      top5,
      allKeywords,
      currentVisibility,
      visibilityHistory,
      aiVisibilityScore,
      aiOverviewCount,
      top10Count,
      averagePosition,
      newRankingsThisMonth,
    });
  } catch (err: any) {
    console.error("SE Ranking error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch SE Ranking data" },
      { status: 500 }
    );
  }
}
