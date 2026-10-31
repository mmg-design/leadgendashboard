import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { cachedBacklinkReport, getBacklinkReport, reportIsStale } from "@/lib/backlinks";

export const maxDuration = 120;

// The Links tab's backlink report. Cached for a week (SE Ranking charges
// credits per lookup, and a rebuild takes up to a minute). A stale report is
// returned right away flagged `stale`, and the tab asks for ?fresh=1 behind it.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!config.integrations.seRanking?.enabled || !process.env.SERANKING_API_KEY) {
    return NextResponse.json({ error: "SE Ranking isn't connected for this client. Turn it on in Settings." }, { status: 404 });
  }
  try {
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const cached = fresh ? null : await cachedBacklinkReport(slug);
    if (cached) return NextResponse.json({ ...cached, stale: reportIsStale(cached) });
    return NextResponse.json(await getBacklinkReport(slug, config, true));
  } catch (err) {
    console.error("Backlinks error:", err);
    // SE Ranking's raw errors aren't for the page: say what happened in plain words.
    const message = (err as Error)?.message || "";
    const error = /SE Ranking (402|403)/.test(message) || /insufficient funds/i.test(message)
      ? "SE Ranking's backlink data is paused because this month's units are used up. Reports come back when the units reset or are topped up. Rank tracking isn't affected."
      : /has no backlink data/i.test(message)
        ? "SE Ranking doesn't have backlink data for this site yet."
        : "Couldn't reach SE Ranking for the backlink report. Try again later.";
    return NextResponse.json({ error }, { status: 503 });
  }
}
