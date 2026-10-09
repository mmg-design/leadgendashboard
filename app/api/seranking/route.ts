import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getSeRankingData } from "@/lib/seranking";

export async function GET(req: NextRequest) {
  const clientSlug = req.nextUrl.searchParams.get("client");
  if (!clientSlug) return NextResponse.json({ error: "Missing client" }, { status: 400 });

  const apiKey = process.env.SERANKING_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "SERANKING_API_KEY not set" }, { status: 503 });

  const fresh = req.nextUrl.searchParams.has("_t");

  try {
    const clientConfig = await getClient(clientSlug);
    const srConfig = clientConfig?.integrations?.seRanking;
    if (!clientConfig || !srConfig?.enabled) {
      return NextResponse.json({ error: "SE Ranking not enabled" }, { status: 404 });
    }
    if (!srConfig.projectId) {
      return NextResponse.json({ error: "SE Ranking project ID not set" }, { status: 400 });
    }

    return NextResponse.json(await getSeRankingData(clientConfig, apiKey, fresh));
  } catch (err) {
    console.error("SE Ranking error:", err);
    return NextResponse.json(
      { error: (err instanceof Error && err.message) || "Failed to fetch SE Ranking data" },
      { status: 500 }
    );
  }
}
