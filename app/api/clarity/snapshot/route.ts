import { NextRequest, NextResponse } from "next/server";
import { getAllClients } from "@/lib/clients";
import { ensureClaritySnapshot } from "@/lib/clarity";

// Daily Vercel cron (see vercel.json). Takes one Clarity snapshot per client at
// a fixed time so days line up evenly. Dashboard visits also take a snapshot
// when today's is missing, so this is a backstop, not a requirement.
//
// Vercel sends `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET set,
// this route refuses every request.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clients = await getAllClients();
  const results: Record<string, string> = {};
  for (const client of clients) {
    if (!client.integrations.clarity?.enabled) continue;
    const result = await ensureClaritySnapshot(client.slug, client);
    results[client.slug] = result.status;
  }
  return NextResponse.json({ ok: true, results });
}
