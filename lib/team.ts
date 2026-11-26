import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getDb } from "./db";

// Team accounts (employees and contractors). Clients never get one.
// The owner is the only seat that delegates; everyone else has a job title.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const TITLES = ["Account Manager", "Developer", "SEO Strategist", "Team Member"] as const;
export type Title = (typeof TITLES)[number] | "Owner";
export type MemberKind = "employee" | "contractor";
export type MemberStatus = "invited" | "active" | "disabled";

export interface TeamMember {
  id: number;
  email: string;
  name: string;
  title: Title;
  kind: MemberKind;
  isOwner: boolean;
  hourlyRateCents: number | null;
  status: MemberStatus;
  sessionVersion: number;
  hasPassword: boolean;
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export const INVITE_DAYS = 7;
export const MIN_PASSWORD = 10;

const normEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: unknown): e is string => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) && e.length <= 160;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function rowToMember(r: Record<string, unknown>): TeamMember {
  return {
    id: Number(r.id),
    email: r.email as string,
    name: r.name as string,
    title: (Number(r.is_owner) === 1 ? "Owner" : r.title) as Title,
    kind: r.kind as MemberKind,
    isOwner: Number(r.is_owner) === 1,
    hourlyRateCents: r.hourly_rate_cents == null ? null : Number(r.hourly_rate_cents),
    status: r.status as MemberStatus,
    sessionVersion: Number(r.session_version),
    hasPassword: !!r.password_hash,
    inviteExpiresAt: (r.invite_expires_at as string) || null,
    lastLoginAt: (r.last_login_at as string) || null,
    createdAt: r.created_at as string,
  };
}

// ── Passwords ────────────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  const [algo, saltHex, keyHex] = (stored || "").split("$");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 200) return "That password is too long.";
  return null;
}

// ── Reads ────────────────────────────────────────────────────────────────────
export async function listMembers(): Promise<TeamMember[]> {
  const db = await getDb();
  const res = await db.execute("SELECT * FROM team_members ORDER BY is_owner DESC, status = 'disabled', name COLLATE NOCASE");
  return res.rows.map((r) => rowToMember(r as Record<string, unknown>));
}

export async function getMember(id: number): Promise<TeamMember | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM team_members WHERE id = ?", args: [id] });
  return res.rows[0] ? rowToMember(res.rows[0] as Record<string, unknown>) : null;
}

export async function hasOwner(): Promise<boolean> {
  const db = await getDb();
  const res = await db.execute("SELECT 1 FROM team_members WHERE is_owner = 1 AND status != 'disabled' LIMIT 1");
  return res.rows.length > 0;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────
// Returns the member on a correct email and password for an active account.
export async function authenticate(email: string, password: string): Promise<TeamMember | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM team_members WHERE email = ?", args: [normEmail(email)] });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  const ok = await checkPassword(password, (row?.password_hash as string) || "scrypt$00$00");
  if (!row || !ok || row.status !== "active") return null;
  await db.execute({ sql: "UPDATE team_members SET last_login_at = datetime('now') WHERE id = ?", args: [Number(row.id)] });
  return rowToMember(row);
}

// ── Owner actions ────────────────────────────────────────────────────────────
export async function createMember(input: {
  email: string; name: string; title?: string; kind?: MemberKind; hourlyRateCents?: number | null; isOwner?: boolean;
}): Promise<{ member: TeamMember; inviteToken: string }> {
  const db = await getDb();
  const email = normEmail(input.email);
  const exists = await db.execute({ sql: "SELECT 1 FROM team_members WHERE email = ?", args: [email] });
  if (exists.rows.length) throw new TeamError("Someone on the team already uses that email.");
  if (input.isOwner && (await hasOwner())) throw new TeamError("There is already an owner.");
  const title = input.isOwner ? "Owner" : TITLES.includes(input.title as (typeof TITLES)[number]) ? input.title! : "Team Member";
  const kind: MemberKind = input.kind === "contractor" ? "contractor" : "employee";
  const res = await db.execute({
    sql: `INSERT INTO team_members (email, name, title, kind, is_owner, hourly_rate_cents) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [email, input.name.trim().slice(0, 80), title, kind, input.isOwner ? 1 : 0, kind === "contractor" ? input.hourlyRateCents ?? null : null],
  });
  const id = Number(res.lastInsertRowid);
  const inviteToken = await issueInvite(id);
  return { member: (await getMember(id))!, inviteToken };
}

// A fresh invite link; any earlier link stops working.
export async function issueInvite(id: number): Promise<string> {
  const db = await getDb();
  const token = randomBytes(24).toString("base64url");
  await db.execute({
    sql: `UPDATE team_members SET invite_token_hash = ?, invite_expires_at = datetime('now', '+${INVITE_DAYS} days'), updated_at = datetime('now') WHERE id = ?`,
    args: [sha256(token), id],
  });
  return token;
}

export async function updateMember(id: number, patch: {
  name?: string; title?: string; kind?: MemberKind; hourlyRateCents?: number | null; status?: "active" | "disabled";
}): Promise<TeamMember> {
  const current = await getMember(id);
  if (!current) throw new TeamError("That person isn't on the team.");
  if (current.isOwner && patch.status === "disabled") throw new TeamError("The owner can't be disabled.");
  const db = await getDb();
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (typeof patch.name === "string" && patch.name.trim()) { sets.push("name = ?"); args.push(patch.name.trim().slice(0, 80)); }
  if (!current.isOwner && typeof patch.title === "string" && TITLES.includes(patch.title as (typeof TITLES)[number])) { sets.push("title = ?"); args.push(patch.title); }
  const kind = patch.kind ?? current.kind;
  if (patch.kind === "employee" || patch.kind === "contractor") { sets.push("kind = ?"); args.push(patch.kind); }
  if (patch.hourlyRateCents !== undefined || patch.kind === "employee") {
    sets.push("hourly_rate_cents = ?");
    args.push(kind === "contractor" ? patch.hourlyRateCents ?? current.hourlyRateCents : null);
  }
  if (patch.status === "disabled" && current.status !== "disabled") {
    // Disabling signs them out everywhere and voids any open invite.
    sets.push("status = 'disabled'", "session_version = session_version + 1", "invite_token_hash = NULL", "invite_expires_at = NULL");
  } else if (patch.status === "active" && current.status === "disabled") {
    sets.push(`status = '${current.hasPassword ? "active" : "invited"}'`);
  }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    await db.execute({ sql: `UPDATE team_members SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  }
  return (await getMember(id))!;
}

// ── Invites ──────────────────────────────────────────────────────────────────
export async function memberForInvite(token: string): Promise<TeamMember | null> {
  if (!token || token.length < 20) return null;
  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT * FROM team_members WHERE invite_token_hash = ? AND invite_expires_at > datetime('now') AND status != 'disabled'",
    args: [sha256(token)],
  });
  return res.rows[0] ? rowToMember(res.rows[0] as Record<string, unknown>) : null;
}

// Sets the password, activates the account and voids the link.
export async function acceptInvite(token: string, password: string): Promise<TeamMember> {
  const member = await memberForInvite(token);
  if (!member) throw new TeamError("This invite link has expired or was already used. Ask for a new one.");
  const problem = passwordProblem(password);
  if (problem) throw new TeamError(problem);
  const db = await getDb();
  await db.execute({
    sql: `UPDATE team_members SET password_hash = ?, status = 'active', session_version = session_version + 1,
          invite_token_hash = NULL, invite_expires_at = NULL, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    args: [await hashPassword(password), member.id],
  });
  return (await getMember(member.id))!;
}

export class TeamError extends Error {}
