import { NextRequest, NextResponse } from "next/server";
import { getRun, syncRun } from "@/lib/agent-runs";

export const maxDuration = 120;

// GitHub's "MMG agent" workflow pings this as its last step. The ping carries
// no trust: it only tells us which run to check, and the run's real state is
// read from GitHub with our own token. The workflow is still wrapping up when
// it pings, so keep checking for up to a minute and a half.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown };
  const id = Number(body.runId);
  const run = Number.isInteger(id) && id > 0 ? await getRun(id) : null;
  if (!run || (run.status !== "queued" && run.status !== "running")) return NextResponse.json({ ok: true });
  for (let i = 0; i < 18; i++) {
    const now = await syncRun(id).catch((err) => { console.error(`Agent run ${id} callback sync failed:`, err); return null; });
    if (now && now.status !== "queued" && now.status !== "running") break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return NextResponse.json({ ok: true });
}
