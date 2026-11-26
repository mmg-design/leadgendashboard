import { DASHBOARD_SESSION_COOKIE, dashboardSessionToken } from "./dashboard-auth";
import { USER_SESSION_COOKIE, verifySession } from "./session";
import { getMember, type TeamMember } from "./team";

// Who is making this request. Two ways in:
// - a team member's own sign-in (USER_SESSION_COOKIE), checked against the
//   database so a disabled account or reset password stops working at once;
// - the shared dashboard password (legacy), treated as the owner until it's retired.

export type Viewer =
  | { type: "member"; member: TeamMember; isOwner: boolean; name: string }
  | { type: "legacy"; isOwner: true; name: string };

type CookieReader = { get(name: string): { value: string } | undefined };

// Short cache so the request gate doesn't hit the database on every request.
const CACHE_MS = 15_000;
const cache = new Map<number, { at: number; member: TeamMember | null }>();

async function cachedMember(id: number): Promise<TeamMember | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.member;
  const member = await getMember(id);
  cache.set(id, { at: Date.now(), member });
  return member;
}

export function forgetMember(id: number) {
  cache.delete(id);
}

export async function getViewer(cookies: CookieReader): Promise<Viewer | null> {
  const claims = await verifySession(cookies.get(USER_SESSION_COOKIE)?.value);
  if (claims) {
    const member = await cachedMember(claims.uid);
    if (member && member.status === "active" && member.sessionVersion === claims.sv) {
      return { type: "member", member, isOwner: member.isOwner, name: member.name };
    }
  }
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    // Local development without a password: behave like the owner.
    return process.env.NODE_ENV !== "production" ? { type: "legacy", isOwner: true, name: "Owner (local)" } : null;
  }
  const legacy = cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  if (legacy && legacy === (await dashboardSessionToken(password))) return { type: "legacy", isOwner: true, name: "MMG Studio" };
  return null;
}

export async function isTeamRequest(cookies: CookieReader): Promise<boolean> {
  return !!(await getViewer(cookies));
}

// Owner-only API routes: a 403 response, or null when the caller is the owner.
export async function ownerOnly(cookies: CookieReader): Promise<Response | null> {
  const viewer = await getViewer(cookies);
  if (!viewer) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!viewer.isOwner) return Response.json({ error: "Only the owner can do that." }, { status: 403 });
  return null;
}
