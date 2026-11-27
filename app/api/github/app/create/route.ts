import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "@/lib/viewer";
import { appStatus, manifest } from "@/lib/github-app";

// Owner only. Starts GitHub's one-click app creation: a page that posts the
// app's manifest to GitHub, where the owner clicks "Create GitHub App".
// ?return=/client-slug brings them back to that client's settings afterwards.
// If the app already exists, goes straight to installing it.
export async function GET(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  const back = req.nextUrl.searchParams.get("return") || "/";
  const returnTo = /^\/[\w/-]*$/.test(back) ? back : "/";
  const existing = await appStatus();
  const state = randomBytes(16).toString("hex");
  const cookie = { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax" as const, path: "/api/github", maxAge: 30 * 60 };

  if (existing) {
    const res = NextResponse.redirect(existing.installed && existing.manageUrl ? existing.manageUrl : existing.installUrl);
    res.cookies.set("mmg_gh_return", returnTo, cookie);
    return res;
  }

  const origin = req.nextUrl.origin;
  const json = JSON.stringify(manifest(origin)).replace(/</g, "\\u003c");
  const attr = json.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Connecting GitHub…</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f8fa;color:#01384C}button{padding:10px 18px;border-radius:8px;border:0;background:#1D475E;color:#fff;font-weight:600;font-size:15px;cursor:pointer}</style></head>
<body><form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${attr}">
<p>Taking you to GitHub to create the MMG Studio agent app…</p><button type="submit">Continue to GitHub</button></form>
<script>document.getElementById("f").submit()</script></body></html>`;
  const res = new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  res.cookies.set("mmg_gh_state", state, cookie);
  res.cookies.set("mmg_gh_return", returnTo, cookie);
  return res;
}
