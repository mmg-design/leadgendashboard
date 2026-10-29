import { NextRequest, NextResponse } from "next/server";
import { finishConnect } from "@/lib/google-oauth";

const STATE_COOKIE = "mmg_google_oauth";

export async function GET(req: NextRequest) {
  let saved: { state?: string; next?: string } = {};
  try { saved = JSON.parse(req.cookies.get(STATE_COOKIE)?.value || "{}"); } catch { /* missing */ }
  const next = saved.next || "/";
  const back = (status: string) => {
    const url = new URL(next, req.nextUrl.origin);
    url.searchParams.set("gmail", status);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/google" });
    return res;
  };
  const params = req.nextUrl.searchParams;
  if (!saved.state || params.get("state") !== saved.state) return back("expired");
  if (params.get("error") || !params.get("code")) return back("cancelled");
  try {
    await finishConnect(params.get("code")!, req.nextUrl.origin);
    return back("connected");
  } catch (err) {
    console.error("Gmail connect error:", err);
    return back("failed");
  }
}
