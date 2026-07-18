export const DASHBOARD_SESSION_COOKIE = "mmg_dashboard_session";

export async function dashboardSessionToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`mmg-leadgen-dashboard:v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
