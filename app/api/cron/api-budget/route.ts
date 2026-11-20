import { NextRequest, NextResponse } from "next/server";
import { runBudgetCheck } from "@/lib/api-budget";

export const maxDuration = 30;

// Daily Vercel cron (vercel.json): checks the DataForSEO balance and SE
// Ranking's data units, posts to Slack when either runs low, and posts a short
// summary on Mondays. Needs CRON_SECRET, like the other crons. ?dry=1 returns
// the messages without posting.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  return NextResponse.json(await runBudgetCheck({ dryRun }));
}
