import { NextRequest, NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE, dashboardSessionToken } from "@/lib/dashboard-auth";

export async function POST(req: NextRequest) {
  const configuredPassword = process.env.DASHBOARD_PASSWORD;
  if (!configuredPassword) {
    return NextResponse.json({ error: "Dashboard password is not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.password !== "string" || body.password !== configuredPassword) {
    // Make rapid password guessing a little more expensive without revealing
    // whether the submitted value was close or malformed.
    await new Promise((resolve) => setTimeout(resolve, 750));
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
