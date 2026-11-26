import { NextRequest, NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE, dashboardSessionToken } from "@/lib/dashboard-auth";
import { authenticate, isEmail } from "@/lib/team";
import { USER_SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

// Two ways to sign in: a team member's email and password, or (while it's still
// in use) the shared dashboard password, which acts as the owner.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const slow = () => new Promise((resolve) => setTimeout(resolve, 750));

  if (body.email !== undefined && body.email !== "") {
    if (!isEmail(body.email) || typeof body.password !== "string") {
      await slow();
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }
    const member = await authenticate(body.email, body.password);
    if (!member) {
      await slow();
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true, name: member.name, isOwner: member.isOwner });
    response.cookies.set(USER_SESSION_COOKIE, await signSession(member.id, member.sessionVersion), sessionCookieOptions);
    response.cookies.set(DASHBOARD_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }

  const configuredPassword = process.env.DASHBOARD_PASSWORD;
  if (!configuredPassword) {
    return NextResponse.json({ error: "Dashboard password is not configured" }, { status: 503 });
  }
  if (typeof body.password !== "string" || body.password !== configuredPassword) {
    // Make rapid password guessing a little more expensive without revealing
    // whether the submitted value was close or malformed.
    await slow();
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DASHBOARD_SESSION_COOKIE, await dashboardSessionToken(configuredPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
