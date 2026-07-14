import { NextRequest, NextResponse } from "next/server";
import { getClient, syntheticEventName, SNIPPET_TRIGGER_TYPES } from "@/lib/clients";

// Public, read-only endpoint fetched by the universal tracking snippet installed
// on a client's live site. Returns only trigger definitions — no secrets.
// Client-defined rules land here automatically; the snippet re-fetches this on
// every page load, so new rules need no further site edits.
export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");
  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const config = await getClient(client);
  if (!config) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const rules = config.goals
    .filter((g) => SNIPPET_TRIGGER_TYPES.includes(g.conversionType))
    .map((g) => ({
      eventName: syntheticEventName(g.id),
      trigger: g.conversionType,
      value: g.conversionValue, // button text / scroll % / seconds, depending on trigger
      scopePagePath: g.scopePagePath || null,
    }));

  return NextResponse.json(
    { rules },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
