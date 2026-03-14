import { NextRequest, NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";
import fs from "fs";
import path from "path";

function getAnalyticsClient(): BetaAnalyticsDataClient {
  // Try env var first (production / Vercel)
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const json = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString();
    const credentials = JSON.parse(json);
    return new BetaAnalyticsDataClient({ credentials });
  }

  // Fall back to local credentials file (development)
  const credPath = path.join(process.cwd(), "web-lead-gen-mvp-97217b4d6543.json");
  if (fs.existsSync(credPath)) {
    return new BetaAnalyticsDataClient({ keyFilename: credPath });
  }

  throw new Error("No Google credentials configured. Set GOOGLE_CREDENTIALS_BASE64 env var or place credentials file.");
}

let analyticsClient: BetaAnalyticsDataClient | null = null;

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");
  const range = req.nextUrl.searchParams.get("range") || "7d";

  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const config = await getClient(client);
  if (!config?.integrations.googleAnalytics?.enabled) {
    return NextResponse.json({ error: "GA not configured for this client" }, { status: 404 });
  }

  const propertyId = config.integrations.googleAnalytics.propertyId;

  // Check cache first (refresh every 15 min)
  const db = await getDb();
  const cached = await db.execute({
    sql: `SELECT data, fetched_at FROM analytics_cache
          WHERE client_slug = ? AND metric_type = 'ga_overview' AND date_range = ?
          AND fetched_at > datetime('now', '-15 minutes')`,
    args: [client, range],
  });

  if (cached.rows.length > 0) {
    return NextResponse.json(JSON.parse(cached.rows[0].data as string));
  }

  const daysMap: Record<string, string> = { "7d": "7daysAgo", "30d": "30daysAgo", "90d": "90daysAgo" };
  const startDate = daysMap[range] || "7daysAgo";

  try {
    if (!analyticsClient) {
      analyticsClient = getAnalyticsClient();
    }

    const [summaryReport, dailyReport, sourcesReport] = await Promise.all([
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate: "today" }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "activeUsers" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
      }),
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate: "today" }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
        ],
        orderBys: [{ dimension: { dimensionName: "date", orderType: "ALPHANUMERIC" } }],
      }),
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate, endDate: "today" }],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
    ]);

    const [pagesReport] = await analyticsClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate, endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    });

    const summaryRow = summaryReport[0]?.rows?.[0];
    const metrics = summaryRow?.metricValues || [];
    const avgDuration = parseFloat(metrics[3]?.value || "0");
    const minutes = Math.floor(avgDuration / 60);
    const seconds = Math.floor(avgDuration % 60);

    const summary = {
      sessions: parseInt(metrics[0]?.value || "0"),
      pageviews: parseInt(metrics[1]?.value || "0"),
      uniqueVisitors: parseInt(metrics[2]?.value || "0"),
      avgSessionDuration: `${minutes}m ${seconds}s`,
      bounceRate: `${(parseFloat(metrics[4]?.value || "0") * 100).toFixed(1)}%`,
    };

    const dailySessions = (dailyReport[0]?.rows || []).map((row) => {
      const dateStr = row.dimensionValues?.[0]?.value || "";
      const formatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      return {
        date: formatted,
        sessions: parseInt(row.metricValues?.[0]?.value || "0"),
        pageviews: parseInt(row.metricValues?.[1]?.value || "0"),
      };
    });

    const topSources = (sourcesReport[0]?.rows || []).map((row) => ({
      source: row.dimensionValues?.[0]?.value || "(unknown)",
      sessions: parseInt(row.metricValues?.[0]?.value || "0"),
    }));

    const topPages = (pagesReport?.rows || []).map((row) => ({
      page: row.dimensionValues?.[0]?.value || "/",
      views: parseInt(row.metricValues?.[0]?.value || "0"),
    }));

    const data = {
      propertyId,
      range,
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
