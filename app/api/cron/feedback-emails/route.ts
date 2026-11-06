import { NextRequest, NextResponse } from "next/server";
import { flushFeedbackEmails } from "@/lib/feedback-email";

export const maxDuration = 120;

// Daily Vercel cron (vercel.json): sends any feedback emails still waiting.
// Normally they go out minutes after activity stops (lib/feedback-email.ts);
// this catches anything a cut-short sender left behind. Needs CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await flushFeedbackEmails({ force: true }));
}
