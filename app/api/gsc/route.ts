import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { GscError, resolveProperty } from "@/lib/gsc";
import { cachedPerformance } from "@/lib/gsc-cache";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

// Search queries, clicks and impressions per page for the selected window.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const range = req.nextUrl.searchParams.get("range") || "7d";
  const fresh = req.nextUrl.searchParams.has("_t");
  if (!slug) return NextResponse.json({ error: "Missing client param" }, { status: 400 });

  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  let property: string | null;
  try {
    property = await resolveProperty(config);
  } catch (err) {
    if (err instanceof GscError) return NextResponse.json({ status: err.kind, message: err.message });
    throw err;
  }
  if (!property) {
    return NextResponse.json({ status: "not_configured", message: "Share this site's Search Console property with the dashboard's service account (in Search Console: Settings, then Users and permissions), or enter the property in Settings." });
  }

  try {
    const data = await cachedPerformance(slug, property, config.domain, range, RANGE_DAYS[range] || 7, fresh);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof GscError) return NextResponse.json({ status: err.kind, message: err.message, property });
    console.error("Search Console error:", err);
    return NextResponse.json({ status: "error", message: "Couldn't load Search Console data.", property });
  }
}
