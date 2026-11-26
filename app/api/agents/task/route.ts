import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getClient } from "@/lib/clients";
import { getTask } from "@/lib/agent-tasks";

// One Agents card with its full draft, for showing it outside the Agents tab
// (the Agent queue) in the same format, with the same Apply actions.
export async function GET(req: NextRequest) {
  if (!(await getViewer(req.cookies))) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const slug = req.nextUrl.searchParams.get("client") || "";
  const key = req.nextUrl.searchParams.get("key") || "";
  const [config, task] = await Promise.all([getClient(slug), getTask(slug, key)]);
  if (!config || !task) return NextResponse.json({ error: "That task isn't on the Agents tab anymore." }, { status: 404 });
  const webflow = config.integrations.webflow;
  return NextResponse.json({
    task,
    webflow: { connected: !!(webflow?.enabled && webflow.apiToken) },
    clickup: !!(config.integrations.clickup?.enabled && config.integrations.clickup.listIds?.length && process.env.CLICKUP_API_KEY),
  });
}
