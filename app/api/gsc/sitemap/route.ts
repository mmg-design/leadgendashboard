import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { GscError, resolveProperty, resubmitSitemaps } from "@/lib/gsc";

// Resubmits the site's sitemaps so Google recrawls sooner. Needs the service
// account to have Full (not Restricted) permission on the property.
export async function POST(req: NextRequest) {
  const { client: slug, origin } = (await req.json()) as { client?: string; origin?: string };
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });

  const config = await getClient(slug);
  const property = config ? await resolveProperty(config).catch(() => null) : null;
  if (!config || !property) return NextResponse.json({ ok: false, message: "Search Console isn't connected for this client." });

  try {
    const submitted = await resubmitSitemaps(property, origin || `https://${config.domain.replace(/^https?:\/\//, "")}`);
    return NextResponse.json({ ok: true, submitted });
  } catch (err) {
    if (err instanceof GscError) {
      const message = err.kind === "no_access"
        ? "Resubmitting needs Full permission. In Search Console, change the service account's permission from Restricted to Full."
        : err.message;
      return NextResponse.json({ ok: false, message });
    }
    console.error("Sitemap resubmit error:", err);
    return NextResponse.json({ ok: false, message: "Couldn't resubmit the sitemap." });
  }
}
