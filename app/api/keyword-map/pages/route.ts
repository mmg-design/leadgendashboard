import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { ownUrl, pageDetails } from "@/lib/keyword-map-pages";

// Index checks take ~8s at Google the first time a URL is seen each day.
export const maxDuration = 60;

// Hotspots, index status and link counts for the Keyword Map canvas's page
// cards. Free reads, cached a day per URL; fresh=true skips those caches.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { client?: string; urls?: unknown; fresh?: boolean };
  if (!body.client || !Array.isArray(body.urls)) return NextResponse.json({ error: "Missing client or urls" }, { status: 400 });
  const config = await getClient(body.client);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  // Keyed back to the URLs as the canvas sent them.
  const asSent = new Map<string, string>();
  for (const raw of body.urls) {
    const url = typeof raw === "string" ? ownUrl(config, raw) : null;
    if (url) asSent.set(url, raw as string);
  }
  try {
    const details = await pageDetails(body.client, config, [...asSent.keys()], !!body.fresh);
    details.pages = Object.fromEntries(Object.entries(details.pages).map(([url, d]) => [asSent.get(url) || url, d]));
    return NextResponse.json(details);
  } catch (err) {
    console.error("Keyword map page details error:", err);
    return NextResponse.json({ error: "Couldn't read the pages. Try again in a minute." }, { status: 500 });
  }
}
