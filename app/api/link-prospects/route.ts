import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getProfile, listProspects, PROFILE_FIELDS, saveProfile, setStage, STAGES, type LinkProfile, type Stage } from "@/lib/link-prospects";

// The Links tab's prospect list and link profile. Research itself runs in
// Claude Code (scripts/link-prospects.ts); this only reads and updates.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const [profile, prospects] = await Promise.all([getProfile(slug), listProspects(slug)]);
  return NextResponse.json({ profile, prospects });
}

// Move a prospect to another stage, or save notes on it.
export async function PATCH(req: NextRequest) {
  const { client: slug, id, stage, notes } = (await req.json()) as { client?: string; id?: number; stage?: Stage; notes?: string };
  if (!slug || !id || (stage && !STAGES.includes(stage))) return NextResponse.json({ error: "Missing client, prospect, or stage" }, { status: 400 });
  await setStage(slug, id, { stage, notes });
  return NextResponse.json({ ok: true });
}

// The team's edits to the link profile. From then on research reads it but
// never overwrites it.
export async function PUT(req: NextRequest) {
  const { client: slug, profile } = (await req.json()) as { client?: string; profile?: Partial<LinkProfile> };
  if (!slug || !profile || !(await getClient(slug))) return NextResponse.json({ error: "Missing client or profile" }, { status: 400 });
  const clean = Object.fromEntries(PROFILE_FIELDS.map(({ key }) => [key, String(profile[key] ?? "")]));
  await saveProfile(slug, clean, "Team");
  return NextResponse.json({ ok: true, profile: await getProfile(slug) });
}
