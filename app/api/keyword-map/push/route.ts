import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { PlanError, pushToAgents } from "@/lib/keyword-plan-store";

// Sends one page's keyword recommendations to Agents as a task. Nothing runs
// here: the draft (and its API cost) only happens when someone presses Run
// agent on the task.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { client?: string; page?: string; recommendations?: string[]; positions?: Record<string, number | null> } | null;
  if (!body?.client || !body.page || !Array.isArray(body.recommendations)) return NextResponse.json({ error: "Missing client, page or recommendations" }, { status: 400 });
  const config = await getClient(body.client);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await pushToAgents(body.client, config, { page: body.page, recommendations: body.recommendations, positions: body.positions })) });
  } catch (err) {
    if (err instanceof PlanError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Keyword map push error:", err);
    return NextResponse.json({ error: "Couldn't send this to Agents. Try again in a minute." }, { status: 500 });
  }
}
