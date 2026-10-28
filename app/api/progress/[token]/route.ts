import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { DASHBOARD_SESSION_COOKIE, isTeamSession } from "@/lib/dashboard-auth";
import { applySettings, cachedReport, portalForToken } from "@/lib/portal";

export const maxDuration = 60;

// The client's progress report, reachable with the private link alone. Only
// works while the team has the page shared; team members can preview it
// before then.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const portal = await portalForToken(token);
  const isTeam = await isTeamSession(req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value);
  if (!portal || (!portal.enabled && !isTeam)) {
    return NextResponse.json({ error: "This progress page isn't available. Ask your MMG team for a new link." }, { status: 404 });
  }
  const config = await getClient(portal.slug);
  if (!config) return NextResponse.json({ error: "This progress page isn't available." }, { status: 404 });
  const report = applySettings(await cachedReport(portal.slug, config, portal.settings), portal.settings, true);
  return NextResponse.json(
    { report, preview: !portal.enabled },
    { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } }
  );
}
