import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { addNote, backfillEvents, deleteNote, googleUpdates, listEvents } from "@/lib/site-events";
import { checkSiteChanges } from "@/lib/site-watch";

export const maxDuration = 60;

// The change timeline for one client: its own events plus Google's ranking
// updates. Also runs the daily site check if the cron hasn't today.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const config = slug ? await getClient(slug) : null;
  if (!slug || !config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  await backfillEvents(slug).catch((err) => console.error("Event backfill error:", err));
  await checkSiteChanges(slug, config).catch((err) => console.error("Site check error:", err));
  const [events, google] = await Promise.all([listEvents(slug), googleUpdates()]);
  return NextResponse.json({ events, google });
}

// Add a note: { client, day: "YYYY-MM-DD", title, page? }
export async function POST(req: NextRequest) {
  const { client: slug, day, title, page } = (await req.json()) as { client?: string; day?: string; title?: string; page?: string };
  if (!slug || !(await getClient(slug))) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !title?.trim()) return NextResponse.json({ error: "Add a date and what changed." }, { status: 400 });
  const path = page?.trim() ? (page.trim().startsWith("/") ? page.trim() : `/${page.trim()}`) : null;
  await addNote(slug, { day, title: title.trim().slice(0, 200), page: path });
  return NextResponse.json({ ok: true });
}

// Remove a note (automatic events can't be removed).
export async function DELETE(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!slug || !id) return NextResponse.json({ error: "Missing client or id" }, { status: 400 });
  return NextResponse.json({ ok: await deleteNote(slug, id) });
}
