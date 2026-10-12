export const DASHBOARD_SESSION_COOKIE = "mmg_dashboard_session";

export async function dashboardSessionToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`mmg-leadgen-dashboard:v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// True when the request carries a valid dashboard session (an MMG team member),
// e.g. on the public review pages, where clients have no session.
export async function isTeamSession(cookieValue: string | undefined): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return process.env.NODE_ENV !== "production";
  return !!cookieValue && cookieValue === (await dashboardSessionToken(password));
}
