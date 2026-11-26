import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getClient } from "@/lib/clients";

// A client's logo by slug, so lists can show it without carrying the image.
// Cached hard; the URL carries a version that changes with the logo.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await getViewer(req.cookies))) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const client = await getClient((await params).slug);
  const icon = client?.iconUrl;
  if (!icon) return new NextResponse(null, { status: 404 });
  const m = icon.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/);
  if (m) {
    return new NextResponse(new Uint8Array(Buffer.from(m[2], "base64")), {
      headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=31536000, immutable" },
    });
  }
  return NextResponse.redirect(new URL(icon, req.url));
}
