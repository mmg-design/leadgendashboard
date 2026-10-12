import { NextRequest } from "next/server";
import { clientForToken, isClientHost, siteOrigin } from "@/lib/feedback";
import { REVIEW_OVERLAY_JS } from "@/lib/review-overlay";

// Shows a client's live page inside the review tool without installing
// anything on their site. We fetch the page, point its relative URLs back at
// the real site (<base>), strip analytics so reviews don't count as visits,
// and add the comment layer. Assets still load straight from the client's
// site; only page navigations come through here.
//
// The response carries a CSP sandbox, so the page runs with an opaque origin:
// its scripts (chat widgets, embeds) can't read MMG Pulse cookies or call its
// API, even though the URL is on data.mmg.studio.

type Params = { params: Promise<{ token: string; path?: string[] }> };

const SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals";

// Analytics and session recorders: a review session shouldn't show up in the
// client's GA4, Clarity, or ad pixels.
const TRACKER_SRC = /googletagmanager\.com|google-analytics\.com|clarity\.ms|connect\.facebook\.net|hotjar\.com|snap\.licdn\.com|static\.ads-twitter\.com|analytics\.tiktok\.com|posthog|plausible\.io|segment\.com|hs-scripts\.com|hs-analytics\.net/i;
const TRACKER_INLINE = /gtag\(|googletagmanager|GoogleAnalyticsObject|clarity\(|fbq\(|_hjSettings|_linkedin_partner_id|posthog\.init|mmgTrack/i;

function page(message: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font:15px/1.5 system-ui;margin:0;display:grid;place-items:center;height:100vh;color:#01384C;background:#F6F8F9"><p style="max-width:420px;text-align:center">${message}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": SANDBOX } }
  );
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function rewrite(html: string, pageUrl: URL, appOrigin: string, token: string) {
  let out = html
    // The page's own CSP/base would fight ours.
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    // Analytics: external tags and inline snippets.
    .replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src: string) => (TRACKER_SRC.test(src) ? "" : tag))
    .replace(/<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi, (tag, _attrs, code: string) => (TRACKER_INLINE.test(code) ? "" : tag))
    .replace(/<noscript>[\s\S]*?googletagmanager[\s\S]*?<\/noscript>/gi, "");

  const config = JSON.stringify({ appOrigin, token, pageUrl: pageUrl.href, proxyPrefix: `${appOrigin}/proxy/${token}` });
  // Storage and cookies throw in an opaque origin; plenty of site scripts
  // (cookie banners, sliders) touch them, so give them in-memory stand-ins.
  const head = `<base href="${escapeAttr(pageUrl.href)}">
<script>(function(){function mem(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
try{window.localStorage.getItem("x")}catch(e){try{Object.defineProperty(window,"localStorage",{value:mem()});Object.defineProperty(window,"sessionStorage",{value:mem()})}catch(_){}}
try{document.cookie}catch(e){try{var c="";Object.defineProperty(document,"cookie",{get:function(){return c},set:function(v){c=(c?c+"; ":"")+String(v).split(";")[0]},configurable:true})}catch(_){}}
window.__MMG_REVIEW=${config};})();</script>
<script>${REVIEW_OVERLAY_JS.replace(/<\/script/gi, "<\\/script")}</script>`;

  if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b[^>]*>/i, (m) => `${m}\n${head}`);
  else out = head + out;
  return out;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { token, path = [] } = await params;
  const client = await clientForToken(token);
  if (!client) return page("This review link isn't valid anymore. Ask MMG Studio for a new one.", 404);

  const origin = siteOrigin(client.domain);
  const search = new URLSearchParams(req.nextUrl.searchParams);
  const target = new URL(`${origin}/${path.map(encodeURIComponent).join("/")}${search.size ? `?${search}` : ""}`);

  let res: Response;
  try {
    res = await fetch(target, {
      headers: {
        "User-Agent": req.headers.get("user-agent") || "Mozilla/5.0 MMG Pulse review",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": req.headers.get("accept-language") || "en-US,en;q=0.9",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return page(`Couldn't reach ${origin.replace("https://", "")}. Try again in a moment.`, 502);
  }

  const finalUrl = new URL(res.url || target.href);
  const type = res.headers.get("content-type") || "";
  // The saved domain now redirects to a different site (a domain change, like
  // 2spsportsperformance.com -> 2spsports.com). Sending the frame there fails,
  // since most sites refuse to load inside another page, so say what happened.
  if (!isClientHost(finalUrl.hostname, client.domain) && type.includes("text/html")) {
    const moved = finalUrl.hostname.replace(/^www\./, "");
    return page(`${client.name}'s site now lives at <b>${moved}</b>. MMG Studio needs to update the website domain for this review link (Settings → Website Domain → ${moved}).`, 409);
  }
  // Anything that isn't a page (PDFs, images) opens directly rather than through the proxy.
  if (!type.includes("text/html")) return Response.redirect(finalUrl.href, 302);

  const html = rewrite(await res.text(), finalUrl, req.nextUrl.origin, token);
  return new Response(html, {
    status: res.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": SANDBOX,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
