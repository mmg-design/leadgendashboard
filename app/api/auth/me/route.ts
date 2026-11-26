import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";

// Who is signed in, for the account menu. Never includes rates.
export async function GET(req: NextRequest) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (viewer.type === "legacy") return NextResponse.json({ type: "legacy", name: viewer.name, isOwner: true });
  const m = viewer.member;
  return NextResponse.json({ type: "member", id: m.id, name: m.name, email: m.email, title: m.title, kind: m.kind, isOwner: m.isOwner, photoVersion: m.photoVersion });
}
