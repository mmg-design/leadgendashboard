import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getDb } from "@/lib/db";
import { ENGINE_LABELS, setUpTracking } from "@/lib/airt";

// Starts AI Result Tracker for a client: sets the brand (if missing), adds the
// chosen engines, and adds the confirmed prompts to each. Uses the SE Ranking
// account's AI tracking allowance, so it only runs on an explicit button press.
export async function POST(req: NextRequest) {
  const { client: slug, prompts, engines, brand } = (await req.json()) as {
    client?: string;
    prompts?: string[];
    engines?: string[];
    brand?: string;
  };
  if (!slug || !Array.isArray(prompts) || !Array.isArray(engines)) {
    return NextResponse.json({ error: "Missing client, prompts, or engines" }, { status: 400 });
  }
  const cleanPrompts = prompts.map((p) => String(p).trim()).filter(Boolean);
  const cleanEngines = engines.filter((e) => ENGINE_LABELS[e]);
  if (cleanPrompts.length === 0 || cleanEngines.length === 0) {
    return NextResponse.json({ error: "Pick at least one prompt and one AI engine." }, { status: 400 });
  }

  const config = await getClient(slug);
  const siteId = config?.integrations.seRanking?.enabled ? config.integrations.seRanking.projectId : "";
  if (!config || !siteId) return NextResponse.json({ error: "SE Ranking isn't connected for this client." }, { status: 400 });

  try {
    const result = await setUpTracking(siteId, {
      brand: brand?.trim() || config.name,
      engines: cleanEngines,
      prompts: cleanPrompts.slice(0, 50),
    });
    const db = await getDb();
    await db.execute({
      sql: `DELETE FROM analytics_cache WHERE client_slug = ? AND metric_type = 'ai_visibility'`,
      args: [slug],
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("AI tracking setup error:", err);
    const message = err instanceof Error ? err.message : "Setup failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
