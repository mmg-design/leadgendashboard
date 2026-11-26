import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { getMemberPhoto } from "@/lib/team";

// A team member's headshot, for anyone signed in. Cached hard: the URL carries
// the photo's version, so a new photo gets a new URL.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getViewer(req.cookies))) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const photo = await getMemberPhoto(Number((await params).id));
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
