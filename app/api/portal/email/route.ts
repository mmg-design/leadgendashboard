import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { applySettings, cachedReport, getPortal } from "@/lib/portal";
import { composeUpdate } from "@/lib/portal-email";
import { createDraft, getConnection, oauthConfigured } from "@/lib/google-oauth";

export const maxDuration = 60;

// The monthly update email, team-only. GET drafts the text; POST saves it to
// the connected Gmail account's drafts. Nothing here ever sends an email.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const config = slug ? await getClient(slug) : null;
  if (!slug || !config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const portal = await getPortal(slug);
  const includeLink = req.nextUrl.searchParams.get("link") !== "0" && portal.enabled;
  const report = applySettings(await cachedReport(slug, config, portal.settings), portal.settings, true);
  const connection = await getConnection();
  const link = includeLink ? `${req.nextUrl.origin}/progress/${portal.token}` : null;
  const draft = composeUpdate(report, { contactName: portal.settings.contactName, senderName: connection?.name || null, link });
  return NextResponse.json({
    to: portal.settings.contactEmail,
    contactName: portal.settings.contactName,
    linkAvailable: portal.enabled,
    ...draft,
    gmail: { configured: oauthConfigured(), connection },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { client?: string; to?: string; subject?: string; body?: string };
  if (!body.client || !(await getClient(body.client))) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const to = (body.to || "").trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+(\s*,\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+)*$/.test(to)) {
    return NextResponse.json({ error: "Add the client's email address first." }, { status: 400 });
  }
  if (!body.subject?.trim() || !body.body?.trim()) return NextResponse.json({ error: "The email is empty." }, { status: 400 });
  const connection = await getConnection();
  if (!connection) return NextResponse.json({ error: "Connect Gmail first." }, { status: 400 });
  try {
    await createDraft({ to, subject: body.subject.trim(), body: body.body });
    return NextResponse.json({ ok: true, draftsUrl: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(connection.email)}#drafts` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save the draft." }, { status: 502 });
  }
}
