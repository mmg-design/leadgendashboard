import { NextRequest, NextResponse } from "next/server";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { getClient } from "@/lib/clients";
import fs from "fs";
import path from "path";

function getAnalyticsClient(): BetaAnalyticsDataClient {
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const json = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString();
    const credentials = JSON.parse(json);
    return new BetaAnalyticsDataClient({ credentials });
  }
  const credPath = path.join(process.cwd(), "web-lead-gen-mvp-97217b4d6543.json");
  if (fs.existsSync(credPath)) {
    return new BetaAnalyticsDataClient({ keyFilename: credPath });
  }
  throw new Error("No Google credentials configured.");
}

let analyticsClient: BetaAnalyticsDataClient | null = null;

// GA4's own automatic events - not useful as a conversion signal since they fire on every visit.
const DEFAULT_EVENTS = new Set([
  "page_view",
  "scroll",
  "session_start",
  "first_visit",
  "user_engagement",
  "click",
  "view_search_results",
  "video_start",
  "video_progress",
  "video_complete",
  "file_download",
]);

const PAGE_KEYWORDS = [
  "thank",
  "confirm",
  "success",
  "complete",
  "booked",
  "submitted",
  "welcome",
  "congrat",
  "scheduled",
];

function guessLabel(value: string, type: "event" | "pageview"): string {
  const v = value.toLowerCase();
  if (v.includes("purchase") || v.includes("order")) return "Made a purchase";
  if (v.includes("book") || v.includes("call") || v.includes("consult") || v.includes("appointment") || v.includes("schedul")) {
    return "Booked a call";
  }
  if (v.includes("download")) return "Downloaded something";
  if (v.includes("registr") || v.includes("signup") || v.includes("sign_up")) return "Signed up";
  if (v.includes("lead") || v.includes("form") || v.includes("submit")) return "Submitted a form";
  if (type === "pageview" && (v.includes("thank") || v.includes("confirm"))) return "Reached thank-you page";
  return "";
}

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");
  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const config = await getClient(client);
  if (!config?.integrations.googleAnalytics?.enabled) {
    return NextResponse.json({ error: "GA not configured for this client" }, { status: 404 });
  }

  const propertyId = config.integrations.googleAnalytics.propertyId;

  try {
    if (!analyticsClient) {
      analyticsClient = getAnalyticsClient();
    }

    const [eventsReport, pagesReport] = await Promise.all([
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 40,
      }),
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 100,
      }),
    ]);

    const eventSuggestions = (eventsReport[0]?.rows || [])
      .map((row) => ({
        name: row.dimensionValues?.[0]?.value || "",
        count: parseInt(row.metricValues?.[0]?.value || "0"),
      }))
      .filter((e) => e.name && !DEFAULT_EVENTS.has(e.name))
      .map((e) => ({ ...e, suggestedLabel: guessLabel(e.name, "event") }))
      .slice(0, 15);

    const pageSuggestions = (pagesReport[0]?.rows || [])
      .map((row) => ({
        path: row.dimensionValues?.[0]?.value || "",
        views: parseInt(row.metricValues?.[0]?.value || "0"),
      }))
      .filter((p) => p.path && PAGE_KEYWORDS.some((kw) => p.path.toLowerCase().includes(kw)))
      .map((p) => ({ ...p, suggestedLabel: guessLabel(p.path, "pageview") }))
      .slice(0, 10);

    return NextResponse.json({ eventSuggestions, pageSuggestions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GA4 discover error:", message);
    return NextResponse.json({ error: "Failed to discover GA4 signals", details: message }, { status: 500 });
  }
}
