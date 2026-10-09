import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { ensureClaritySnapshot, getClaritySummary } from "@/lib/clarity";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

// Clarity behavior for the same window as the dashboard's GA toggle. Pulls
// today's snapshot if it's missing, then adds up stored snapshots for the range.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const range = req.nextUrl.searchParams.get("range") || "7d";
  if (!slug) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const config = await getClient(slug);
  if (!config?.integrations?.clarity?.enabled) {
    return NextResponse.json({ error: "Clarity not enabled for this client" }, { status: 400 });
  }

  try {
    const ensure = await ensureClaritySnapshot(slug, config);
    const summary = await getClaritySummary(slug, config, RANGE_DAYS[range] || 7, ensure);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("Clarity summary error:", err);
    return NextResponse.json({ error: "Failed to load Clarity data" }, { status: 500 });
  }
}
