import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "@/lib/viewer";
import { getClient, updateClient } from "@/lib/clients";
import { GitHubAppError, hasGitHubAccess } from "@/lib/github-app";
import { mergeSetup, setupRepo, setupStatus, SetupError } from "@/lib/repo-setup";

const REPO = /^[\w.-]+\/[\w.-]+$/;
const message = (err: unknown, fallback: string) => (err instanceof SetupError || err instanceof GitHubAppError || err instanceof Error ? err.message : fallback);

// Owner only. GET ?client= : the client's repo and how far its agent setup has got.
export async function GET(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  const client = await getClient(req.nextUrl.searchParams.get("client") || "");
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const gh = client.integrations.github;
  if (!gh?.enabled || !gh.repo) return NextResponse.json({ repo: null, status: null });
  if (!(await hasGitHubAccess())) return NextResponse.json({ repo: gh.repo, status: null, error: "GitHub isn't connected." });
  try {
    return NextResponse.json({ repo: gh.repo, status: await setupStatus(gh.repo, client.domain, gh.dir) });
  } catch (err) {
    return NextResponse.json({ repo: gh.repo, status: null, error: message(err, "Couldn't check the repo.") });
  }
}

// Owner only.
//   { client, action: "setup", repo, dir? }  connect the repo and set the agent up (key + setup pull request)
//   { client, action: "merge" }              merge the setup pull request
//   { client, action: "disconnect" }         stop using the repo for this client
export async function POST(req: NextRequest) {
  const denied = await ownerOnly(req.cookies);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { client?: string; action?: string; repo?: string; dir?: string };
  const client = await getClient(body.client || "");
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  if (body.action === "disconnect") {
    await updateClient(client.slug, { integrations: { github: { enabled: false, repo: "" } } });
    return NextResponse.json({ repo: null, status: null });
  }

  const repo = body.action === "merge" ? client.integrations.github?.repo : body.repo?.trim();
  if (!repo || !REPO.test(repo)) return NextResponse.json({ error: "Pick a repo first." }, { status: 400 });
  const dir = typeof body.dir === "string" ? body.dir.trim().replace(/^\.?\/+|\/+$/g, "") : client.integrations.github?.repo === repo ? client.integrations.github?.dir : undefined;
  try {
    if (body.action === "merge") await mergeSetup(repo);
    const status = body.action === "merge" ? await setupStatus(repo, client.domain, dir) : await setupRepo(repo, { name: client.name, domain: client.domain }, dir);
    await updateClient(client.slug, {
      integrations: {
        site: { platform: "github" },
        github: {
          enabled: true, repo, baseBranch: status.info.defaultBranch, dir: status.info.dir,
          previewUrl: status.info.previewTemplate || client.integrations.github?.previewUrl || undefined,
        },
      },
    });
    return NextResponse.json({ repo, status });
  } catch (err) {
    console.error("Repo setup failed:", err);
    return NextResponse.json({ error: message(err, "Couldn't set the repo up.") }, { status: 400 });
  }
}
