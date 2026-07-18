import { NextRequest, NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE, dashboardSessionToken } from "@/lib/dashboard-auth";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "data.mmg.studio";
const RESERVED_SUBDOMAINS = new Set(["www", "app", "admin", "dashboard"]);

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/track-config"]);

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.has(pathname);
  const configuredPassword = process.env.DASHBOARD_PASSWORD;

  if (!configuredPassword && process.env.NODE_ENV === "production") {
    return new NextResponse("Dashboard access is unavailable until DASHBOARD_PASSWORD is configured.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (configuredPassword && !isPublic) {
    const expected = await dashboardSessionToken(configuredPassword);
    const session = req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
    if (session !== expected) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      const login = req.nextUrl.clone();
      login.pathname = "/login";
      login.search = "";
      login.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(login);
    }
  }

  // Public endpoints should never be rewritten as client-subdomain pages.
  if (isPublic) return NextResponse.next();

  const host = req.headers.get("host")?.split(":")[0].toLowerCase();
  if (!host) return NextResponse.next();

  const rootDomain = ROOT_DOMAIN.toLowerCase();
  const suffix = `.${rootDomain}`;

  if (!host.endsWith(suffix)) {
    return NextResponse.next();
  }

  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain || subdomain.includes(".") || RESERVED_SUBDOMAINS.has(subdomain)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = `/${subdomain}${url.pathname === "/" ? "" : url.pathname}`;

  const res = NextResponse.rewrite(url);
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|mmg-icon.png|.*\\..*).*)"],
};
