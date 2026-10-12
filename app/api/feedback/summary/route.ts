import { NextResponse } from "next/server";
import { openFeedbackCounts } from "@/lib/feedback";

// Open client-feedback comments per client, for the home page cards.
export async function GET() {
  return NextResponse.json({ open: await openFeedbackCounts() });
}
