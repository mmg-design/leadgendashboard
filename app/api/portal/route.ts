import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { applySettings, cachedReport, getPortal, rotatePortalToken, updatePortal, type PortalSettings } from "@/lib/portal";

export const maxDuration = 60;

// Team side of the client progress page: the link, whether it's shared, the
// lead value and start date, and per-item hide / reword. Behind the dashboard
// password like every other /api route.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const portal = await getPortal(slug);
  const withReport = req.nextUrl.searchParams.has("report");
  const report = withReport
    ? applySettings(await cachedReport(slug, config, portal.settings, req.nextUrl.searchParams.has("fresh")), portal.settings, false)
    : null;
  return NextResponse.json({ enabled: portal.enabled, token: portal.token, settings: portal.settings, report });
}

type Body = {
  client?: string;
  enabled?: boolean;
  rotate?: boolean;
  settings?: Partial<Pick<PortalSettings, "startedAt" | "leadValue">>;
  hide?: { key: string; hidden: boolean };
  override?: { key: string; title?: string; why?: string };
};

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const slug = body.client;
  if (!slug || !(await getClient(slug))) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if (body.rotate) {
    const p = await rotatePortalToken(slug);
    return NextResponse.json({ enabled: p.enabled, token: p.token, settings: p.settings });
  }

  const current = (await getPortal(slug)).settings;
  const next: Partial<PortalSettings> = {};
  if (body.settings) {
    if ("startedAt" in body.settings) next.startedAt = body.settings.startedAt || null;
    if ("leadValue" in body.settings) next.leadValue = body.settings.leadValue ? Number(body.settings.leadValue) : null;
  }
  if (body.hide?.key) {
    const set = new Set(current.hidden);
    if (body.hide.hidden) set.add(body.hide.key);
    else set.delete(body.hide.key);
    next.hidden = [...set];
  }
  if (body.override?.key) {
    const overrides = { ...current.overrides };
    const { key, title, why } = body.override;
    if (!title?.trim() && !why?.trim()) delete overrides[key];
    else overrides[key] = { title: title?.trim() || undefined, why: why?.trim() || undefined };
    next.overrides = overrides;
  }
  const p = await updatePortal(slug, { enabled: typeof body.enabled === "boolean" ? body.enabled : undefined, settings: next });
  return NextResponse.json({ enabled: p.enabled, token: p.token, settings: p.settings });
}
