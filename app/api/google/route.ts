import { NextResponse } from "next/server";
import { disconnect, getConnection, oauthConfigured } from "@/lib/google-oauth";

// Whether Gmail drafts are available, and as whom.
export async function GET() {
  return NextResponse.json({ configured: oauthConfigured(), connection: await getConnection() });
}

export async function DELETE() {
  await disconnect();
  return NextResponse.json({ ok: true });
}
