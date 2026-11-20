import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { cachedBacklinkReport, getBacklinkReport, reportIsStale } from "@/lib/backlinks";
import { dataForSeoConnected } from "@/lib/dataforseo";

export const maxDuration = 120;

// The Links tab's backlink report, from DataForSEO. Cached for 14 days
// (lookups are paid per call). A stale report is returned right away flagged
// `stale`, and the tab asks for ?fresh=1 behind it.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!dataForSeoConnected()) {
    // Until DataForSEO is connected, keep showing the last report (from SE
    // Ranking) rather than an empty tab; it just can't refresh.
    const cached = await cachedBacklinkReport(slug);
    if (cached && req.nextUrl.searchParams.get("fresh") !== "1") return NextResponse.json({ ...cached, stale: false });
    return NextResponse.json({ error: "DataForSEO isn't connected. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment." }, { status: 404 });
  }
  try {
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const cached = fresh ? null : await cachedBacklinkReport(slug);
    if (cached) return NextResponse.json({ ...cached, stale: reportIsStale(cached) });
    return NextResponse.json(await getBacklinkReport(slug, config, true));
  } catch (err) {
    console.error("Backlinks error:", err);
    // DataForSEO's raw errors aren't for the page: say what happened in plain words.
    const message = (err as Error)?.message || "";
    const error = /DataForSEO 402\d\d/.test(message)
      ? "DataForSEO's backlink data is paused: the account balance or the Backlinks subscription needs attention. Rank tracking isn't affected."
      : /DataForSEO 401\d\d/.test(message)
        ? "DataForSEO rejected the login. Check DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (the API password, not the account password)."
        : /has no backlink data/i.test(message)
          ? "DataForSEO doesn't have backlink data for this site yet."
          : "Couldn't reach DataForSEO for the backlink report. Try again later.";
    return NextResponse.json({ error }, { status: 503 });
  }
}
