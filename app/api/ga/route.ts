import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";
import { getAnalyticsClient, conversionFilterFor } from "@/lib/ga-client";
import { GA_LAG_DAYS } from "@/lib/data-lag";

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");
  const range = req.nextUrl.searchParams.get("range") || "7d";
  const isRefresh = req.nextUrl.searchParams.has("_t");

  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const config = await getClient(client);
  if (!config?.integrations.googleAnalytics?.enabled) {
    return NextResponse.json({ error: "GA not configured for this client" }, { status: 404 });
  }

  const propertyId = config.integrations.googleAnalytics.propertyId;

  // Check cache first (refresh every 15 min) - skipped on manual refresh
  const db = await getDb();
  if (!isRefresh) {
    const cached = await db.execute({
      sql: `SELECT data, fetched_at FROM analytics_cache
            WHERE client_slug = ? AND metric_type = 'ga_overview' AND date_range = ?
            AND fetched_at > datetime('now', '-15 minutes')`,
      args: [client, range],
    });
    if (cached.rows.length > 0) {
      const cachedData = JSON.parse(cached.rows[0].data as string);
      // Older cached payloads used a non-adjacent 60–31-days-ago baseline, or
      // predate the device/source splits; refetch those instead of serving them.
      if (cachedData?.comparison?.previous && cachedData?.devices && cachedData?.dailySources && cachedData.comparison.current?.endDate === `${GA_LAG_DAYS}daysAgo`) {
        return NextResponse.json(cachedData);
      }
    }
  }

  const periodDays: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
  const days = periodDays[range] || 7;
  // GA date ranges are inclusive. The window ends GA_LAG_DAYS back so today's
  // half-collected numbers don't show as a drop: with a one-day lag, seven days
  // run from 7 days ago through yesterday. The comparison is the seven before.
  const currentDateRange = { startDate: `${days + GA_LAG_DAYS - 1}daysAgo`, endDate: `${GA_LAG_DAYS}daysAgo`, name: "current" };
  const previousDateRange = {
    startDate: `${days * 2 + GA_LAG_DAYS - 1}daysAgo`,
    endDate: `${days + GA_LAG_DAYS}daysAgo`,
    name: "previous",
  };
  const goals = config.goals;

  try {
    const analyticsClient = getAnalyticsClient();

    const [summaryReport, dailyReport, sourcesReport, dailyPagesReport, devicesReport, dailySourcesReport] = await Promise.all([
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentDateRange, previousDateRange],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "activeUsers" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
          { name: "engagementRate" },
          { name: "engagedSessions" },
        ],
      }),
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentDateRange],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ dimension: { dimensionName: "date", orderType: "ALPHANUMERIC" } }],
      }),
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentDateRange],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
      // Per-day top pages for the traffic chart's hover tooltip - ordered by date
      // then views-desc within each date, so we can just take the first 3 per day.
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentDateRange],
        dimensions: [{ name: "date" }, { name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [
          { dimension: { dimensionName: "date", orderType: "ALPHANUMERIC" } },
          { metric: { metricName: "screenPageViews" }, desc: true },
        ],
        limit: 5000,
      }),
      // Mobile vs desktop split for the overview's device card.
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentDateRange],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "sessions" }, { name: "engagementRate" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      }),
      // Sessions per day per source, for the traffic chart's source breakdown.
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentDateRange],
        dimensions: [{ name: "date" }, { name: "sessionSource" }],
        metrics: [{ name: "sessions" }],
        limit: 10000,
      }),
    ]);

    const goalResults = await Promise.all(
      goals.map(async (goal) => {
        const [summary, daily, sourceBreakdown] = await Promise.all([
          analyticsClient.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [currentDateRange, previousDateRange],
            metrics: [{ name: "eventCount" }],
            dimensionFilter: conversionFilterFor(goal),
          }),
          analyticsClient.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [currentDateRange],
            dimensions: [{ name: "date" }],
            metrics: [{ name: "eventCount" }],
            dimensionFilter: conversionFilterFor(goal),
            orderBys: [{ dimension: { dimensionName: "date", orderType: "ALPHANUMERIC" } }],
          }),
          // Aggregate traffic-source breakdown scoped to this conversion - not
          // individual visitors (GA4 doesn't expose per-user IP/identity), just
          // "what channel started sessions that included this conversion event."
          analyticsClient.runReport({
            property: `properties/${propertyId}`,
            dateRanges: [currentDateRange],
            dimensions: [{ name: "sessionSourceMedium" }],
            metrics: [{ name: "eventCount" }],
            dimensionFilter: conversionFilterFor(goal),
            orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
            limit: 5,
          }),
        ]);

        const rows = summary[0]?.rows || [];
        const currentRow = rows.find((row) => row.dimensionValues?.some((value) => value.value === "current")) || rows[0];
        const previousRow = rows.find((row) => row.dimensionValues?.some((value) => value.value === "previous")) || rows[1];
        const current = parseInt(currentRow?.metricValues?.[0]?.value || "0");
        const prev = parseInt(previousRow?.metricValues?.[0]?.value || "0");
        const change = prev > 0 ? Math.round(((current - prev) / prev) * 100) : null;

        const dailyCounts = (daily[0]?.rows || []).map((row) => {
          const dateStr = row.dimensionValues?.[0]?.value || "";
          const formatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
          return { date: formatted, count: parseInt(row.metricValues?.[0]?.value || "0") };
        });

        const sources = (sourceBreakdown[0]?.rows || []).map((row) => ({
          source: row.dimensionValues?.[0]?.value || "(unknown)",
          count: parseInt(row.metricValues?.[0]?.value || "0"),
        }));

        return {
          id: goal.id,
          page: goal.conversionValue,
          label: goal.label,
          count: current,
          previousCount: prev,
          change,
          daily: dailyCounts,
          sources,
        };
      })
    );

    const [pagesReport] = await analyticsClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [currentDateRange],
      dimensions: [{ name: "pagePath" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "engagementRate" },
        { name: "averageSessionDuration" },
      ],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    });

    const rows = summaryReport[0]?.rows || [];
    const currentRow = rows.find((row) => row.dimensionValues?.some((value) => value.value === "current")) || rows[0];
    const prevRow = rows.find((row) => row.dimensionValues?.some((value) => value.value === "previous")) || rows[1];
    const metrics = currentRow?.metricValues || [];
    const prevMetrics = prevRow?.metricValues || [];
    const avgDuration = parseFloat(metrics[3]?.value || "0");
    const minutes = Math.floor(avgDuration / 60);
    const seconds = Math.floor(avgDuration % 60);
    const currentSessions = parseInt(metrics[0]?.value || "0");
    const prevSessions = parseInt(prevMetrics[0]?.value || "0");
    const sessionChange = prevSessions > 0
      ? Math.round(((currentSessions - prevSessions) / prevSessions) * 100)
      : null;

    const summary = {
      sessions: currentSessions,
      previousSessions: prevSessions,
      sessionsChange: sessionChange,
      pageviews: parseInt(metrics[1]?.value || "0"),
      uniqueVisitors: parseInt(metrics[2]?.value || "0"),
      avgSessionDuration: `${minutes}m ${seconds}s`,
      bounceRate: `${(parseFloat(metrics[4]?.value || "0") * 100).toFixed(1)}%`,
      engagementRate: `${(parseFloat(metrics[5]?.value || "0") * 100).toFixed(1)}%`,
      engagedSessions: parseInt(metrics[6]?.value || "0"),
      conversions: goalResults,
    };

    const dailyTopPages = new Map<string, { page: string; views: number }[]>();
    for (const row of dailyPagesReport[0]?.rows || []) {
      const dateStr = row.dimensionValues?.[0]?.value || "";
      const formatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      const list = dailyTopPages.get(formatted) || [];
      if (list.length < 3) {
        list.push({
          page: row.dimensionValues?.[1]?.value || "/",
          views: parseInt(row.metricValues?.[0]?.value || "0"),
        });
        dailyTopPages.set(formatted, list);
      }
    }

    const dailySessions = (dailyReport[0]?.rows || []).map((row) => {
      const dateStr = row.dimensionValues?.[0]?.value || "";
      const formatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      return {
        date: formatted,
        sessions: parseInt(row.metricValues?.[0]?.value || "0"),
        pageviews: parseInt(row.metricValues?.[1]?.value || "0"),
        topPages: dailyTopPages.get(formatted) || [],
      };
    });

    const topSources = (sourcesReport[0]?.rows || []).map((row) => ({
      source: row.dimensionValues?.[0]?.value || "(unknown)",
      sessions: parseInt(row.metricValues?.[0]?.value || "0"),
    }));

    const topPages = (pagesReport?.rows || []).map((row) => ({
      page: row.dimensionValues?.[0]?.value || "/",
      views: parseInt(row.metricValues?.[0]?.value || "0"),
      engagementScore: Math.round(parseFloat(row.metricValues?.[1]?.value || "0") * 100),
      avgDuration: Math.round(parseFloat(row.metricValues?.[2]?.value || "0")),
    }));

    const devices = (devicesReport[0]?.rows || []).map((row) => ({
      device: row.dimensionValues?.[0]?.value || "(not set)",
      sessions: parseInt(row.metricValues?.[0]?.value || "0"),
      engagementRate: Math.round(parseFloat(row.metricValues?.[1]?.value || "0") * 100),
    }));

    const dailySources = (dailySourcesReport[0]?.rows || []).map((row) => {
      const dateStr = row.dimensionValues?.[0]?.value || "";
      return {
        date: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
        source: row.dimensionValues?.[1]?.value || "(not set)",
        sessions: parseInt(row.metricValues?.[0]?.value || "0"),
      };
    });

    const data = {
      propertyId,
      range,
      devices,
      dailySources,
      comparison: {
        current: currentDateRange,
        previous: previousDateRange,
        label: `previous ${days} days`,
      },
      summary,
      dailySessions,
      topSources,
      topPages,
    };

    // Cache it
    await db.execute({
      sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data)
            VALUES (?, 'ga_overview', ?, ?)`,
      args: [client, range, JSON.stringify(data)],
    });

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GA4 API error:", message);
    return NextResponse.json(
      { error: "Failed to fetch GA data", details: message },
      { status: 500 }
    );
  }
}
