import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { eventImpact } from "@/lib/event-impact";

// Before/after Google search numbers for one change (cached 12h).
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const raw = req.nextUrl.searchParams.get("id") || "";
  const config = slug ? await getClient(slug) : null;
  if (!slug || !config || !raw) return NextResponse.json({ error: "Missing client or id" }, { status: 400 });
  try {
    const impact = await eventImpact(slug, config, raw.startsWith("google:") ? raw : Number(raw));
    if (!impact) return NextResponse.json({ error: "Change not found" }, { status: 404 });
    return NextResponse.json(impact);
  } catch (err) {
    console.error("Impact error:", err);
    return NextResponse.json({ status: "no_data", scope: "site", daysAfter: 0, window: 14, overlaps: [] });
  }
}
