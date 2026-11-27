import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "@/lib/viewer";
import { GitHubAppError, saveFromManifestCode } from "@/lib/github-app";

// GitHub sends the owner here after "Create GitHub App" with a one-time code.
// We trade it for the app's keys (stored encrypted), then send them on to
// install the app and choose which repos it can reach.
export async function GET(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const back = req.cookies.get("mmg_gh_return")?.value || "/";
  if (!code || !state || state !== req.cookies.get("mmg_gh_state")?.value) {
    return NextResponse.redirect(new URL(`${back}?github=error&reason=${encodeURIComponent("That GitHub link expired. Start again from the client's settings.")}`, req.nextUrl.origin));
  }
  try {
    const app = await saveFromManifestCode(code);
    const res = NextResponse.redirect(app.installUrl);
    res.cookies.delete({ name: "mmg_gh_state", path: "/api/github" });
    return res;
  } catch (err) {
    const reason = err instanceof GitHubAppError ? err.message : "Couldn't finish creating the GitHub app.";
    console.error("GitHub app creation failed:", err);
    return NextResponse.redirect(new URL(`${back}?github=error&reason=${encodeURIComponent(reason)}`, req.nextUrl.origin));
  }
}
