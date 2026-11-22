import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { buildKeywordMap } from "@/lib/keyword-map";
import { PlanError, savePlan, type SaveInput } from "@/lib/keyword-plan-store";

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

// Saves the plan from the canvas: which page targets which keyword (at most 3
// a page), terms taken off every page, and edits to each page's
// recommendations. Rejected with 409 if someone else saved first.
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as (SaveInput & { client?: string }) | null;
  if (!body?.client || !Array.isArray(body.terms)) return NextResponse.json({ error: "Missing client or terms" }, { status: 400 });
  if (!(await getClient(body.client))) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await savePlan(body.client, body)) });
  } catch (err) {
    if (err instanceof PlanError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Keyword plan save error:", err);
    return NextResponse.json({ error: "Couldn't save the keyword plan. Try again in a minute." }, { status: 500 });
  }
}
