import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";

interface ClarityPageData {
  page: string;
  engagementScore: number;
  totalSessions: number;
  scrollDepth?: number;
}

interface ClarityResponse {
  topSessionUrl: string;
  pageEngagement: ClarityPageData[];
  projectId: string;
  rageClicks: number;
  deadClicks: number;
  homepageScrollDepth: number | null;
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
      return NextResponse.json({
        topSessionUrl,
        projectId,
        pageEngagement: cachedData.pageEngagement ?? cachedData,
        rageClicks: cachedData.rageClicks ?? 0,
        deadClicks: cachedData.deadClicks ?? 0,
        homepageScrollDepth: cachedData.homepageScrollDepth ?? null,
      });
    }
  }

  let pageEngagement: ClarityPageData[] = [];
  let rageClicks = 0;
  let deadClicks = 0;
  let homepageScrollDepth: number | null = null;

  try {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const [urlRes, siteRes] = await Promise.all([
      fetch(`https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3&dimension1=URL`, { headers }),
      fetch(`https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=30`, { headers }),
    ]);

    if (urlRes.ok) {
      const metricGroups: any[] = (await urlRes.json()) || [];
      const urlMap: Record<string, { sessions: number; scrollDepth: number; pagesPerSession: number; activeTime: number }> = {};

      for (const group of metricGroups) {
        if (!group.information) continue;
        for (const item of group.information) {
          const url = item.Url || item.URL || "";
          if (!url) continue;
          if (!urlMap[url]) urlMap[url] = { sessions: 0, scrollDepth: 0, pagesPerSession: 0, activeTime: 0 };
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
        .map(([url, m]) => {
          const scrollScore = Math.min(m.scrollDepth, 100);
          const timeScore = Math.min((m.activeTime / 120) * 100, 100);
          const pagesScore = Math.min((m.pagesPerSession / 3) * 100, 100);
          const engagementScore = Math.round(scrollScore * 0.4 + timeScore * 0.35 + pagesScore * 0.25);
          return { page: url, engagementScore, totalSessions: m.sessions, scrollDepth: m.scrollDepth };
        })
        .sort((a, b) => b.engagementScore - a.engagementScore)
        .slice(0, 10);

      // Homepage scroll depth — match root path or index
      const homeEntry = Object.entries(urlMap).find(([url]) => {
        try { const p = new URL(url).pathname; return p === "/" || p === "" || p === "/index"; }
        catch { return url.endsWith("/") && !url.slice(0, -1).includes("/", 8); }
      });
      if (homeEntry) homepageScrollDepth = Math.round(homeEntry[1].scrollDepth);
    }

    if (siteRes.ok) {
      const siteGroups: any[] = (await siteRes.json()) || [];
      for (const group of siteGroups) {
        if (group.metricName === "RageClick" || group.metricName === "RageClicks") {
          const info = group.information?.[0];
          rageClicks = Number(info?.count ?? info?.totalCount ?? info?.value ?? 0);
        } else if (group.metricName === "DeadClick" || group.metricName === "DeadClicks") {
          const info = group.information?.[0];
          deadClicks = Number(info?.count ?? info?.totalCount ?? info?.value ?? 0);
        }
      }
    }

    const cachePayload = { pageEngagement, rageClicks, deadClicks, homepageScrollDepth };
    if (urlRes.ok) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
              VALUES (?, 'clarity_engagement', 'live', ?, datetime('now'))`,
        args: [client, JSON.stringify(cachePayload)],
      });
    }

    if (urlRes.status === 429 && cached.rows.length > 0) {
      const stale = JSON.parse(cached.rows[0].data as string);
      return NextResponse.json({ topSessionUrl, projectId, pageEngagement: stale.pageEngagement ?? stale, rageClicks: stale.rageClicks ?? 0, deadClicks: stale.deadClicks ?? 0, homepageScrollDepth: stale.homepageScrollDepth ?? null });
    }

    if (!urlRes.ok) {
      const body = await urlRes.text();
      console.log(`Clarity API responded ${urlRes.status}: ${body}`);
    }
  } catch (err) {
    console.error("Clarity API error:", err);
  }

  return NextResponse.json({ topSessionUrl, pageEngagement, projectId, rageClicks, deadClicks, homepageScrollDepth });
}

// POST: seed/update the Clarity engagement cache
export async function POST(req: NextRequest) {
  try {
    const { client, pageEngagement } = await req.json();
    if (!client || !Array.isArray(pageEngagement)) {
      return NextResponse.json({ error: "Missing client or pageEngagement" }, { status: 400 });
    }
    const db = await getDb();
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at)
            VALUES (?, 'clarity_engagement', 'live', ?, datetime('now'))`,
      args: [client, JSON.stringify(pageEngagement)],
    });
    return NextResponse.json({ ok: true, cached: pageEngagement.length });
  } catch (err) {
    console.error("Clarity cache seed error:", err);
    return NextResponse.json({ error: "Failed to seed cache" }, { status: 500 });
  }
}
