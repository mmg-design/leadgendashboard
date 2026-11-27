import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "@/lib/viewer";
import { appStatus, GitHubAppError, hasGitHubAccess, listRepos } from "@/lib/github-app";

// Owner only. The dashboard's GitHub connection: the app (if made), whether it's
// installed, and with ?repos=1 the repos it can reach, for the repo picker.
export async function GET(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  const [app, access] = await Promise.all([appStatus(), hasGitHubAccess()]);
  let repos: Awaited<ReturnType<typeof listRepos>> | null = null;
  let error: string | null = null;
  if (req.nextUrl.searchParams.get("repos") === "1" && access) {
    try { repos = await listRepos(); } catch (err) { error = err instanceof GitHubAppError || err instanceof Error ? err.message : "Couldn't list repos."; }
  }
  return NextResponse.json({ app, access, viaToken: access && !app?.installed, repos, error });
}
