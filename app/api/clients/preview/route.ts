import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { sitePreview } from "@/lib/site-preview";

export const maxDuration = 60;

// Screenshot of a client's homepage for the home page cards (JPEG).
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  const config = await getClient(slug);
  if (!config?.domain) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const jpeg = await sitePreview(slug, config.domain);
  if (!jpeg) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      // The browser keeps it for an hour; the server refreshes it daily.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
