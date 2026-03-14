import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";

interface ClarityPageData {
  page: string;
  engagementScore: number;
  totalSessions: number;
}

interface ClarityResponse {
  topSessionUrl: string;
  pageEngagement: ClarityPageData[];
  projectId: string;
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (Clarity allows ~10 req/day)

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client") || "example-client";
  const config = await getClient(client);

  if (!config?.integrations?.clarity?.enabled) {
    return NextResponse.json(
      { error: "Clarity not enabled for this client" },
      { status: 400 }
    );
  }

  const projectId = config.integrations.clarity.projectId;
  const token = process.env.CLARITY_API_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "CLARITY_API_TOKEN not configured" },
      { status: 500 }
    );
  }

  const topSessionUrl = `https://clarity.microsoft.com/projects/view/${projectId}/dashboard`;

  // Check cache first
  const db = await getDb();
  const cached = await db.execute({
    sql: `SELECT data, fetched_at FROM analytics_cache
          WHERE client_slug = ? AND metric_type = 'clarity_engagement' AND date_range = 'live'`,
    args: [client],
  });

  if (cached.rows.length > 0) {
    const fetchedAt = new Date(cached.rows[0].fetched_at as string).getTime();
    if (Date.now() - fetchedAt < CACHE_TTL_MS) {
      const cachedData = JSON.parse(cached.rows[0].data as string);
      return NextResponse.json({ topSessionUrl, pageEngagement: cachedData, projectId });
    }
  }

  let pageEngagement: ClarityPageData[] = [];
  try {
    // numOfDays max is 3 (Clarity API limit)
    const res = await fetch(
      `https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3&dimension1=URL`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (res.ok) {
      // Response is an array of metric groups: [{metricName, information[]}, ...]
      const data = await res.json();
      const metricGroups = Array.isArray(data) ? data : [];

      // Build a map of URL -> metrics from all metric groups
      const urlMap: Record<string, { sessions: number; scrollDepth: number; pagesPerSession: number; activeTime: number }> = {};

      for (const group of metricGroups) {
        if (!group.information) continue;
        for (const item of group.information) {
          const url = item.Url || item.URL;
          if (!url) continue;
          if (!urlMap[url]) {
            urlMap[url] = { sessions: 0, scrollDepth: 0, pagesPerSession: 0, activeTime: 0 };
          }
          if (group.metricName === "Traffic") {
            urlMap[url].sessions = Number(item.totalSessionCount) || 0;
            urlMap[url].pagesPerSession = Number(item.pagesPerSessionPercentage) || 0;
          } else if (group.metricName === "ScrollDepth") {
            urlMap[url].scrollDepth = Number(item.averageScrollDepth) || 0;
          } else if (group.metricName === "EngagementTime") {
            urlMap[url].activeTime = Number(item.activeTime) || 0;
          }
        }
      }

      pageEngagement = Object.entries(urlMap)
        .map(([url, metrics]) => {
          const scrollScore = Math.min(metrics.scrollDepth, 100);
          const timeScore = Math.min((metrics.activeTime / 120) * 100, 100);
          const pagesScore = Math.min((metrics.pagesPerSession / 3) * 100, 100);
          const engagementScore = Math.round(
            scrollScore * 0.4 + timeScore * 0.35 + pagesScore * 0.25
          );
          return {
            page: url,
            engagementScore,
            totalSessions: metrics.sessions,
          };
        })
        .sort((a, b) => b.engagementScore - a.engagementScore)
        .slice(0, 10);

      // Cache the result
      if (pageEngagement.length > 0) {
        await db.execute({
          sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
                VALUES (?, 'clarity_engagement', 'live', ?, datetime('now'))`,
          args: [client, JSON.stringify(pageEngagement)],
        });
      }
    } else if (res.status === 429) {
      // Rate limited — serve stale cache if available
      if (cached.rows.length > 0) {
        const staleData = JSON.parse(cached.rows[0].data as string);
        return NextResponse.json({ topSessionUrl, pageEngagement: staleData, projectId });
      }
      console.log("Clarity API rate limited (429) — no cache available");
    } else {
      const body = await res.text();
      console.log(`Clarity API responded ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error("Clarity API error:", err);
  }

  const response: ClarityResponse = {
    topSessionUrl,
    pageEngagement,
    projectId,
  };

  return NextResponse.json(response);
}
