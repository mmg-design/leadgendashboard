import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { GscError, resolveProperty, type IndexStatus } from "@/lib/gsc";
import { cachedInspections } from "@/lib/gsc-cache";

// Index status for a handful of pages (cached a day per URL).
export async function POST(req: NextRequest) {
  const { client: slug, urls, fresh } = (await req.json()) as { client?: string; urls?: string[]; fresh?: boolean };
  if (!slug || !Array.isArray(urls)) return NextResponse.json({ error: "Missing client or urls" }, { status: 400 });

  const config = await getClient(slug);
  const property = config ? await resolveProperty(config).catch(() => null) : null;
  if (!property) return NextResponse.json({ status: "not_configured", results: {} });

  const results: Record<string, IndexStatus> = {};
  try {
    await cachedInspections(slug, property, urls, !!fresh, results);
    return NextResponse.json({ status: "ok", results });
  } catch (err) {
    // Keep whatever finished before the failure.
    if (err instanceof GscError) return NextResponse.json({ status: err.kind, message: err.message, results });
    console.error("URL inspection error:", err);
    return NextResponse.json({ status: "error", message: "Couldn't check index status.", results });
  }
}
