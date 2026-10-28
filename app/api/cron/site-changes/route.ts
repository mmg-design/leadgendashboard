import { NextRequest, NextResponse } from "next/server";
import { getAllClients } from "@/lib/clients";
import { checkSiteChanges } from "@/lib/site-watch";

export const maxDuration = 120;

// Daily Vercel cron (vercel.json): checks every client's sitemap and Webflow
// publish date for changes made outside MMG Pulse. Needs CRON_SECRET, like the
// Clarity snapshot cron.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clients = await getAllClients();
  await Promise.allSettled(clients.map((c) => checkSiteChanges(c.slug, c, true)));
  return NextResponse.json({ ok: true, checked: clients.length });
}
