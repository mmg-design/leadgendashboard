import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { lastScan, listTasks, saveScan, scanClient, scanIsStale, updateTask, type TaskStatus } from "@/lib/agent-tasks";
import { agentModelName } from "@/lib/agent-llm";

export const maxDuration = 120;

// The Agents tab's task list. Scans automatically when the last scan is more
// than 12 hours old, or on demand with ?scan=1.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  let scan = await lastScan(slug);
  if (req.nextUrl.searchParams.get("scan") === "1" || scanIsStale(scan)) {
    try {
      const result = await scanClient(slug, config);
      await saveScan(slug, result.tasks, result.summary);
      scan = result.summary;
    } catch (err) {
      console.error("Agent scan error:", err);
      if (!scan) return NextResponse.json({ error: "The scan failed. Try again in a minute." }, { status: 500 });
    }
  }

  const webflow = config.integrations.webflow;
  return NextResponse.json({
    tasks: await listTasks(slug),
    scan,
    model: agentModelName(),
    webflow: webflow?.enabled && webflow.apiToken ? { connected: true, siteName: webflow.siteName || null } : { connected: false },
    clickup: !!(config.integrations.clickup?.enabled && config.integrations.clickup.listIds?.length && process.env.CLICKUP_API_KEY),
  });
}

const STATUSES: TaskStatus[] = ["open", "drafted", "applied", "done", "dismissed"];

// Mark a task done, dismiss it, or reopen it.
export async function PATCH(req: NextRequest) {
  const { client: slug, key, status } = (await req.json()) as { client?: string; key?: string; status?: TaskStatus };
  if (!slug || !key || !status || !STATUSES.includes(status)) return NextResponse.json({ error: "Missing client, key, or status" }, { status: 400 });
  await updateTask(slug, key, { status });
  return NextResponse.json({ ok: true });
}
