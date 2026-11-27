import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "@/lib/viewer";
import { GitHubAppError, saveInstallation } from "@/lib/github-app";

// GitHub sends the owner here after installing the app (or changing which
// repos it can reach). We check the installation is really ours, save it,
// and go back to the client's settings.
export async function GET(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  const back = req.cookies.get("mmg_gh_return")?.value || "/";
  const id = Number(req.nextUrl.searchParams.get("installation_id"));
  if (!id) return NextResponse.redirect(new URL(`${back}?github=connected`, req.nextUrl.origin));
  try {
    await saveInstallation(id);
    return NextResponse.redirect(new URL(`${back}?github=connected`, req.nextUrl.origin));
  } catch (err) {
    const reason = err instanceof GitHubAppError ? err.message : "Couldn't save the GitHub installation.";
    console.error("GitHub app install failed:", err);
    return NextResponse.redirect(new URL(`${back}?github=error&reason=${encodeURIComponent(reason)}`, req.nextUrl.origin));
  }
}
