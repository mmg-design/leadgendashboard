import { NextRequest, NextResponse } from "next/server";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "mmg.studio";
const RESERVED_SUBDOMAINS = new Set(["www", "app", "admin", "dashboard"]);

export function middleware(req: NextRequest) {
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

  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
