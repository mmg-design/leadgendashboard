import { BetaAnalyticsDataClient } from "@google-analytics/data";
import fs from "fs";
import path from "path";
import { syntheticEventName, SNIPPET_TRIGGER_TYPES, type GoalConfig } from "./clients";

// GA4 Data API client and goal filters, shared by /api/ga and the client
// progress page.

let analyticsClient: BetaAnalyticsDataClient | null = null;

export function getAnalyticsClient(): BetaAnalyticsDataClient {
  if (analyticsClient) return analyticsClient;
  // Try env var first (production / Vercel)
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const json = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString();
    analyticsClient = new BetaAnalyticsDataClient({ credentials: JSON.parse(json) });
    return analyticsClient;
  }

  // Fall back to local credentials file (development)
  const credPath = path.join(process.cwd(), "web-lead-gen-mvp-97217b4d6543.json");
  if (fs.existsSync(credPath)) {
    analyticsClient = new BetaAnalyticsDataClient({ keyFilename: credPath });
    return analyticsClient;
  }

  throw new Error("No Google credentials configured. Set GOOGLE_CREDENTIALS_BASE64 env var or place credentials file.");
}

export function conversionFilterFor(goal: GoalConfig) {
  if (goal.conversionType === "event") {
    return {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT" as const, value: goal.conversionValue },
      },
    };
  }
  if (SNIPPET_TRIGGER_TYPES.includes(goal.conversionType)) {
    return {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT" as const, value: syntheticEventName(goal.id) },
      },
    };
  }
  return {
    andGroup: {
      expressions: [
        { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT" as const, value: "page_view" } } },
        { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT" as const, value: goal.conversionValue } } },
      ],
    },
  };
}
