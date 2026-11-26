import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/viewer";
import { deleteEntry, editEntry, getEntry, TimeError } from "@/lib/time";

type Params = { params: Promise<{ id: string }> };

// Your own entries, or anyone's for the owner. Edits are stamped with who and when.
async function load(req: NextRequest, params: Params["params"]) {
  const viewer = await getViewer(req.cookies);
  if (!viewer) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const entry = await getEntry(Number((await params).id));
  const mine = viewer.type === "member" && entry?.memberId === viewer.member.id;
  if (!entry || (!mine && !viewer.isOwner)) return { error: NextResponse.json({ error: "Time entry not found." }, { status: 404 }) };
  return { viewer, entry };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const r = await load(req, params);
  if ("error" in r) return r.error;
  const body = (await req.json().catch(() => ({}))) as { minutes?: number; note?: string | null };
  try {
    const entry = await editEntry(r.entry.id, r.viewer.type === "member" ? r.viewer.member.id : null, {
      minutes: body.minutes === undefined ? undefined : Number(body.minutes),
      note: body.note,
    });
    return NextResponse.json({ entry });
  } catch (err) {
    if (err instanceof TimeError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const r = await load(req, params);
  if ("error" in r) return r.error;
  if (!r.entry.endedAt) return NextResponse.json({ error: "Stop the timer first." }, { status: 400 });
  await deleteEntry(r.entry.id);
  return NextResponse.json({ ok: true });
}
