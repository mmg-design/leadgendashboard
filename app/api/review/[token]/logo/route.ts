import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { clientForToken } from "@/lib/feedback";

// The client's logo as a PNG for feedback emails. Uploaded logos are stored as
// WebP data URLs, which Gmail and Outlook won't show; files in /public are
// linked as they are. The URL carries a version, so it caches for good.
type Params = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const client = await clientForToken(token);
  const icon = client?.iconUrl;
  if (!icon) return new NextResponse(null, { status: 404 });
  if (!icon.startsWith("data:")) return NextResponse.redirect(new URL(icon, req.nextUrl.origin));
  const data = icon.match(/^data:image\/[a-z+]+;base64,(.+)$/)?.[1];
  if (!data) return new NextResponse(null, { status: 404 });
  const png = await sharp(Buffer.from(data, "base64")).resize(96, 96, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
