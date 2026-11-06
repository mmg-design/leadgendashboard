import { NextRequest, NextResponse } from "next/server";
import { clientForToken, removePhoto, savePhoto } from "@/lib/feedback";

// A commenter sets or clears their profile photo from the review page. Like
// commenting, the review link is the only credential.
type Params = { params: Promise<{ token: string }> };
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const client = await clientForToken(token);
  if (!client) return NextResponse.json({ error: "This review link isn't valid anymore." }, { status: 404 });
  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const who = { name: clip(input.authorName, 80), email: clip(input.authorEmail, 160) || null };
  if (!who.name) return NextResponse.json({ error: "Add your name first." }, { status: 400 });

  if (input.photo === null) {
    await removePhoto(client.slug, who);
  } else if (typeof input.photo !== "string" || !(await savePhoto(client.slug, who, input.photo))) {
    return NextResponse.json({ error: "That photo couldn't be used. Try a JPEG or PNG." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
