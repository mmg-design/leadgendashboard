import { NextRequest, NextResponse } from "next/server";
import { getViewer, forgetMember } from "@/lib/viewer";
import { setMemberPhoto, TeamError } from "@/lib/team";

// Your own headshot: { image: dataUrl } to set it, { image: null } to remove it.
export async function POST(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (viewer.type !== "member") return NextResponse.json({ error: "Sign in with your own login to add a photo." }, { status: 403 });
  const { image } = (await req.json().catch(() => ({}))) as { image?: string | null };
  try {
    const member = await setMemberPhoto(viewer.member.id, typeof image === "string" ? image : null);
    forgetMember(member.id);
    return NextResponse.json({ photoVersion: member.photoVersion });
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
