import { NextRequest, NextResponse } from "next/server";
import { ownerOnly, forgetMember } from "@/lib/viewer";
import { createMember, issueInvite, isEmail, listMembers, TeamError, TITLES, updateMember, getMember, hasOwner, INVITE_DAYS, setMemberPhoto, type TeamMember } from "@/lib/team";
import { getConnection, sendEmail } from "@/lib/google-oauth";

// Owner only: the team list (with hourly rates), invites and edits.

const rateCents = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 2000 ? Math.round(n * 100) : undefined;
};

async function sendInvite(member: TeamMember, url: string): Promise<boolean> {
  if (!(await getConnection().catch(() => null))) return false;
  const first = member.name.split(" ")[0];
  const text = `Hi ${first},\n\nYou've been added to the MMG Studio dashboard as ${member.title}. Set your password here (the link works for ${INVITE_DAYS} days):\n\n${url}\n\nMMG Studio`;
  const html = `<p>Hi ${first},</p><p>You've been added to the MMG Studio dashboard as <strong>${member.title}</strong>.</p><p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1D475E;color:#fff;text-decoration:none;font-weight:600">Set your password</a></p><p style="color:#5b6b78;font-size:13px">The link works for ${INVITE_DAYS} days. If the button doesn't work, paste this into your browser:<br>${url}</p><p>MMG Studio</p>`;
  try {
    await sendEmail({ to: member.email, subject: "Your MMG Studio dashboard login", text, html, fromName: "MMG Studio" });
    return true;
  } catch (err) {
    console.error("Team invite email failed:", err);
    return false;
  }
}

export async function GET(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  return NextResponse.json({ members: await listMembers(), titles: TITLES, hasOwner: await hasOwner(), inviteDays: INVITE_DAYS });
}

// { email, name, title, kind, hourlyRate, isOwner? } adds someone and sends the invite.
// { action: "resend", id } issues a new invite link (the old one stops working).
export async function POST(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const origin = req.nextUrl.origin;
  try {
    if (body.action === "resend") {
      const member = await getMember(Number(body.id));
      if (!member || member.status === "disabled") return NextResponse.json({ error: "That person isn't active." }, { status: 400 });
      if (member.hasPassword) return NextResponse.json({ error: "They've already set a password." }, { status: 400 });
      const url = `${origin}/invite/${await issueInvite(member.id)}`;
      return NextResponse.json({ inviteUrl: url, emailed: await sendInvite(member, url) });
    }
    if (!isEmail(body.email)) return NextResponse.json({ error: "Add a valid email." }, { status: 400 });
    if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "Add their name." }, { status: 400 });
    const rate = rateCents(body.hourlyRate);
    if (body.hourlyRate !== undefined && body.hourlyRate !== "" && rate === undefined) return NextResponse.json({ error: "Use an hourly rate between 0 and 2,000." }, { status: 400 });
    const { member, inviteToken } = await createMember({
      email: body.email, name: body.name, title: String(body.title || ""), kind: body.kind === "contractor" ? "contractor" : "employee",
      hourlyRateCents: rate ?? null, isOwner: body.isOwner === true,
    });
    const url = `${origin}/invite/${inviteToken}`;
    return NextResponse.json({ member, inviteUrl: url, emailed: await sendInvite(member, url) });
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

// { id, name?, title?, kind?, hourlyRate?, status? }
export async function PATCH(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rate = rateCents(body.hourlyRate);
  if (body.hourlyRate !== undefined && body.hourlyRate !== "" && body.hourlyRate !== null && rate === undefined) {
    return NextResponse.json({ error: "Use an hourly rate between 0 and 2,000." }, { status: 400 });
  }
  try {
    if (body.photo !== undefined) {
      await setMemberPhoto(Number(body.id), typeof body.photo === "string" ? body.photo : null);
    }
    const member = await updateMember(Number(body.id), {
      name: typeof body.name === "string" ? body.name : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      kind: body.kind === "contractor" || body.kind === "employee" ? body.kind : undefined,
      hourlyRateCents: rate,
      status: body.status === "disabled" || body.status === "active" ? body.status : undefined,
    });
    forgetMember(member.id);
    return NextResponse.json({ member });
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
