import { NextRequest, NextResponse } from "next/server";
import { authUrl, oauthConfigured } from "@/lib/google-oauth";

const STATE_COOKIE = "mmg_google_oauth";

// Starts "Connect Gmail". `next` is where to land afterwards (a dashboard path).
export async function GET(req: NextRequest) {
  if (!oauthConfigured()) return NextResponse.json({ error: "Google sign-in isn't set up yet." }, { status: 503 });
  const next = req.nextUrl.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(req.nextUrl.origin, state));
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, next: safeNext }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/google",
  });
  return res;
}
