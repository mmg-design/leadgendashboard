import { NextRequest, NextResponse } from "next/server";
import { clientForToken, isClientHost, siteOrigin } from "@/lib/feedback";
import { assetPath, CSS_FILE, FONT_FILE, rewriteCssUrls } from "@/lib/review-assets";

// Passes a client's font files and stylesheets through to the review tool
// with Access-Control-Allow-Origin, so the sandboxed page can use them (see
// lib/review-assets.ts). Only fonts and CSS from the client's own site.
type Params = { params: Promise<{ token: string; path: string[] }> };

const FONT_TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject" };

export async function GET(req: NextRequest, { params }: Params) {
  const { token, path } = await params;
  const client = await clientForToken(token);
  if (!client) return new NextResponse(null, { status: 404 });
  const url = new URL(`${siteOrigin(client.domain)}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`);
  const isClient = (u: URL) => /^https?:$/.test(u.protocol) && isClientHost(u.hostname, client.domain);
  const isFont = FONT_FILE.test(url.pathname);
  const isCss = CSS_FILE.test(url.pathname);
  if (!isFont && !isCss) return new NextResponse(null, { status: 404 });

  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": req.headers.get("user-agent") || "Mozilla/5.0 MMG Pulse review" }, signal: AbortSignal.timeout(15000) });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  if (!res.ok) return new NextResponse(null, { status: res.status });

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    "X-Robots-Tag": "noindex",
  };
  if (isCss) {
    const css = rewriteCssUrls(await res.text(), url, { isClient, proxy: (u) => assetPath(req.nextUrl.origin, token, u), absolutize: true });
    return new NextResponse(css, { headers: { ...headers, "Content-Type": "text/css; charset=utf-8" } });
  }
  const ext = url.pathname.split(".").pop()!.toLowerCase();
  return new NextResponse(await res.arrayBuffer(), { headers: { ...headers, "Content-Type": FONT_TYPES[ext] || res.headers.get("content-type") || "application/octet-stream" } });
}
