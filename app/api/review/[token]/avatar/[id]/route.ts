import { NextRequest, NextResponse } from "next/server";
import { clientForToken, getPhoto } from "@/lib/feedback";

// Serves a commenter's photo. The URL carries a version, so it can be cached
// for good; a new photo gets a new URL. Also loaded by Slack and email clients.
type Params = { params: Promise<{ token: string; id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { token, id } = await params;
  const client = await clientForToken(token);
  const photo = client && /^\d+$/.test(id) ? await getPhoto(client.slug, Number(id)) : null;
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
