import { NextRequest, NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE, isTeamSession } from "@/lib/dashboard-auth";
import { clientForToken, createFeedback, getFeedback, isClientHost, listFeedback, setSlackTs, type Anchor, type Device } from "@/lib/feedback";
import { notifyNewFeedback } from "@/lib/slack";

// Public, link-scoped API behind a client's review link: read the comments on
// their site and leave new ones. The token is the only credential.

type Params = { params: Promise<{ token: string }> };
const DEVICES: Device[] = ["desktop", "tablet", "mobile"];
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const client = await clientForToken(token);
  if (!client) return NextResponse.json({ error: "This review link isn't valid anymore." }, { status: 404 });
  return NextResponse.json({
    client: { name: client.name, domain: client.domain, iconUrl: client.iconUrl || null, slug: client.slug },
    isTeam: await isTeamSession(req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value),
    comments: await listFeedback(client.slug),
  });
}

function browserLabel(ua: string) {
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : "";
  return os ? `${b} on ${os}` : b;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const client = await clientForToken(token);
  if (!client) return NextResponse.json({ error: "This review link isn't valid anymore." }, { status: 404 });
  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const body = clip(input.body, 5000);
  const authorName = clip(input.authorName, 80);
  const kind = input.kind === "approval" ? "approval" : "comment";
  if ((!body && kind === "comment") || !authorName) return NextResponse.json({ error: "Add your name and a comment." }, { status: 400 });

  let pageUrl: URL;
  try {
    pageUrl = new URL(clip(input.pageUrl, 2000));
  } catch {
    return NextResponse.json({ error: "Missing page." }, { status: 400 });
  }
  if (!isClientHost(pageUrl.hostname, client.domain)) return NextResponse.json({ error: "That page isn't on this site." }, { status: 400 });

  const a = input.anchor as Partial<Anchor> | undefined;
  const num = (v: unknown, max = 1e6) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
  const anchor: Anchor | null = a && typeof a.selector === "string"
    ? { selector: a.selector.slice(0, 1000), text: clip(a.text, 200), offsetX: num(a.offsetX, 1), offsetY: num(a.offsetY, 1), docX: num(a.docX), docY: num(a.docY) }
    : null;
  const isTeam = await isTeamSession(req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value);

  const id = await createFeedback(client.slug, {
    kind,
    pageUrl: pageUrl.href,
    pagePath: pageUrl.pathname || "/",
    pageTitle: clip(input.pageTitle, 200) || null,
    device: DEVICES.includes(input.device as Device) ? (input.device as Device) : "desktop",
    viewportWidth: typeof input.viewportWidth === "number" ? Math.round(input.viewportWidth) : null,
    anchor,
    body: body || "Approved this page",
    authorName,
    authorEmail: clip(input.authorEmail, 160) || null,
    isTeam,
    browser: browserLabel(req.headers.get("user-agent") || ""),
  });

  const created = await getFeedback(client.slug, id);
  if (created) {
    const ts = await notifyNewFeedback(created, client.name, `${req.nextUrl.origin}/review/${token}?c=${id}`);
    if (ts) await setSlackTs(id, ts);
  }
  return NextResponse.json({ ok: true, comment: created });
}
