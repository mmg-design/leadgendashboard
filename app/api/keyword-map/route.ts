import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { buildKeywordMap } from "@/lib/keyword-map";

export const maxDuration = 60;

// The Keyword Map tab. Free reads only (saved core set, SE Ranking project
// API, cached Search Console and sitemap); ?fresh=1 skips those caches.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  try {
    const map = await buildKeywordMap(slug, config, req.nextUrl.searchParams.get("fresh") === "1");
    if (!map) return NextResponse.json({ error: "no_core_set" }, { status: 404 });
    return NextResponse.json(map);
  } catch (err) {
    console.error("Keyword map error:", err);
    return NextResponse.json({ error: "Couldn't build the keyword map. Try again in a minute." }, { status: 500 });
  }
}
