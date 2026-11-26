import { NextRequest, NextResponse } from "next/server";
import { acceptInvite, memberForInvite, TeamError } from "@/lib/team";
import { USER_SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";
import { DASHBOARD_SESSION_COOKIE } from "@/lib/dashboard-auth";

// Public: the invite link a new team member opens to set their password.
export async function GET(req: NextRequest) {
  const member = await memberForInvite(req.nextUrl.searchParams.get("token") || "");
  if (!member) return NextResponse.json({ error: "This invite link has expired or was already used. Ask for a new one." }, { status: 404 });
  return NextResponse.json({ name: member.name, email: member.email, title: member.title });
}

export async function POST(req: NextRequest) {
  const { token, password } = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
  try {
    const member = await acceptInvite(token || "", password || "");
    const response = NextResponse.json({ ok: true, name: member.name, isOwner: member.isOwner });
    response.cookies.set(USER_SESSION_COOKIE, await signSession(member.id, member.sessionVersion), sessionCookieOptions);
    response.cookies.set(DASHBOARD_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
