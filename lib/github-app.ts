import { createSign, randomBytes } from "crypto";
import { getDb } from "./db";
import { open, seal } from "./secret-box";

// The dashboard's own GitHub app: how it reaches client repos to set the agent
// up and carry tasks out. Made once with GitHub's manifest flow (the owner
// clicks Create on GitHub), then installed on the repos it may touch. Nobody
// copies keys: GitHub hands the app's private key straight to the dashboard,
// which stores it encrypted and swaps it for one-hour installation tokens.
// GITHUB_AGENT_TOKEN (a personal token) still works as a fallback.

const LABEL = "github-app";
// GitHub's API; GITHUB_API_URL points local tests at a stand-in.
const API = process.env.GITHUB_API_URL || "https://api.github.com";

export class GitHubAppError extends Error {}

export interface GitHubAppStatus {
  slug: string;
  htmlUrl: string | null;
  owner: string | null;
  installed: boolean;
  installUrl: string;
  manageUrl: string | null;
}

interface AppRow {
  app_id: number; slug: string; client_id: string | null; html_url: string | null; owner_login: string | null;
  pem_enc: string; installation_id: number | null;
}

async function appRow(): Promise<AppRow | null> {
  const db = await getDb();
  const r = (await db.execute("SELECT * FROM github_app WHERE id = 1")).rows[0];
  return r ? (r as unknown as AppRow) : null;
}

export async function appStatus(): Promise<GitHubAppStatus | null> {
  const row = await appRow();
  if (!row) return null;
  return {
    slug: row.slug,
    htmlUrl: row.html_url,
    owner: row.owner_login,
    installed: !!row.installation_id,
    installUrl: `https://github.com/apps/${row.slug}/installations/new`,
    // Where the owner picks which repos the app can reach.
    manageUrl: row.installation_id ? `https://github.com/settings/installations/${row.installation_id}` : null,
  };
}

// ── Creating the app (manifest flow) ────────────────────────────────────────

// What the app asks for: enough to set the agent up in a repo and carry tasks
// out there, nothing more. No webhooks: the dashboard asks GitHub when it needs to.
export function manifest(origin: string) {
  return {
    name: `MMG Studio Agent ${randomBytes(2).toString("hex")}`,
    url: origin,
    description: "Lets the MMG Studio dashboard set up its website agent in client repos and open pull requests for review.",
    redirect_url: `${origin}/api/github/app/callback`,
    setup_url: `${origin}/api/github/app/installed`,
    setup_on_update: true,
    public: false,
    hook_attributes: { url: `${origin}/api/github/app/hook`, active: false },
    default_events: [],
    default_permissions: {
      metadata: "read",
      contents: "write", // the setup branch, reading the site's code
      pull_requests: "write", // setup and agent pull requests
      actions: "write", // start the agent workflow
      workflows: "write", // add the agent workflow file
      secrets: "write", // give the repo the agent's Anthropic key
      checks: "read", // preview links from build checks
      statuses: "read",
      deployments: "read", // Vercel preview links
    },
  };
}

// GitHub sends the owner back with a one-time code; trade it for the app's keys.
export async function saveFromManifestCode(code: string): Promise<GitHubAppStatus> {
  const res = await fetch(`${API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mmg-studio-dashboard" },
    cache: "no-store",
  });
  const d = await res.json().catch(() => ({})) as {
    id?: number; slug?: string; client_id?: string; client_secret?: string; webhook_secret?: string | null; pem?: string; html_url?: string; owner?: { login?: string }; message?: string;
  };
  if (!res.ok || !d.id || !d.pem || !d.slug) throw new GitHubAppError(`GitHub didn't finish creating the app: ${d.message || res.statusText}`);
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO github_app (id, app_id, slug, client_id, html_url, owner_login, pem_enc, client_secret_enc, webhook_secret_enc)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET app_id = excluded.app_id, slug = excluded.slug, client_id = excluded.client_id, html_url = excluded.html_url,
            owner_login = excluded.owner_login, pem_enc = excluded.pem_enc, client_secret_enc = excluded.client_secret_enc,
            webhook_secret_enc = excluded.webhook_secret_enc, installation_id = NULL, updated_at = datetime('now')`,
    args: [d.id, d.slug, d.client_id || null, d.html_url || null, d.owner?.login || null, seal(d.pem, LABEL),
      d.client_secret ? seal(d.client_secret, LABEL) : null, d.webhook_secret ? seal(d.webhook_secret, LABEL) : null],
  });
  cached = null;
  return (await appStatus())!;
}

// After installing, GitHub sends the owner back with the installation's id.
// Only accept it if it really belongs to our app.
export async function saveInstallation(installationId: number): Promise<GitHubAppStatus> {
  const row = await appRow();
  if (!row) throw new GitHubAppError("Create the GitHub app first.");
  const res = await fetch(`${API}/app/installations/${installationId}`, { headers: appHeaders(row), cache: "no-store" });
  const d = await res.json().catch(() => ({})) as { id?: number; app_id?: number; account?: { login?: string }; message?: string };
  if (!res.ok || d.app_id !== Number(row.app_id)) throw new GitHubAppError("That installation isn't for the dashboard's GitHub app.");
  const db = await getDb();
  await db.execute({ sql: "UPDATE github_app SET installation_id = ?, owner_login = COALESCE(?, owner_login), updated_at = datetime('now') WHERE id = 1", args: [installationId, d.account?.login || null] });
  cached = null;
  return (await appStatus())!;
}

// ── Tokens ──────────────────────────────────────────────────────────────────

function appJwt(row: AppRow): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: row.client_id || String(row.app_id) })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(open(row.pem_enc, LABEL), "base64url");
  return `${unsigned}.${signature}`;
}

const appHeaders = (row: AppRow) => ({
  Authorization: `Bearer ${appJwt(row)}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mmg-studio-dashboard",
});

let cached: { token: string; expires: number } | null = null;

// A token for GitHub calls: the app's installation token when the app is set
// up, otherwise the GITHUB_AGENT_TOKEN env var. Null when neither exists.
export async function githubToken(): Promise<string | null> {
  if (cached && cached.expires - Date.now() > 5 * 60_000) return cached.token;
  const row = await appRow().catch(() => null);
  if (row?.installation_id) {
    const res = await fetch(`${API}/app/installations/${row.installation_id}/access_tokens`, { method: "POST", headers: appHeaders(row), cache: "no-store" });
    const d = await res.json().catch(() => ({})) as { token?: string; expires_at?: string; message?: string };
    if (res.ok && d.token) {
      cached = { token: d.token, expires: Date.parse(d.expires_at || "") || Date.now() + 50 * 60_000 };
      return d.token;
    }
    console.error("GitHub app token failed:", d.message || res.status);
  }
  return process.env.GITHUB_AGENT_TOKEN || null;
}

export async function hasGitHubAccess(): Promise<boolean> {
  if (process.env.GITHUB_AGENT_TOKEN) return true;
  const row = await appRow().catch(() => null);
  return !!row?.installation_id;
}

// Repos the app can reach (or the personal token, as a fallback).
export async function listRepos(): Promise<{ fullName: string; private: boolean; defaultBranch: string; pushedAt: string | null }[]> {
  const token = await githubToken();
  if (!token) throw new GitHubAppError("Connect GitHub first.");
  const row = await appRow().catch(() => null);
  const url = row?.installation_id ? `${API}/installation/repositories?per_page=100` : `${API}/user/repos?per_page=100&sort=pushed`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mmg-studio-dashboard" }, cache: "no-store" });
  const d = await res.json().catch(() => ({})) as { repositories?: GhRepo[]; message?: string } | GhRepo[];
  if (!res.ok) throw new GitHubAppError(`GitHub: ${(d as { message?: string }).message || res.statusText}`);
  const repos = Array.isArray(d) ? d : d.repositories || [];
  return repos
    .map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch, pushedAt: r.pushed_at || null }))
    .sort((a, b) => (b.pushedAt || "").localeCompare(a.pushedAt || ""));
}
interface GhRepo { full_name: string; private: boolean; default_branch: string; pushed_at?: string }

// ── Calling GitHub ──────────────────────────────────────────────────────────

export class GitHubApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// A GitHub REST call with the dashboard's token. Throws GitHubApiError with
// GitHub's status on failure, and GitHubAppError when GitHub isn't connected.
export async function ghApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await githubToken();
  if (!token) throw new GitHubAppError("GitHub isn't connected. Connect it in a client's settings, under Where is this website built?");
  const res = await fetch(`${API}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mmg-studio-dashboard",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GitHubApiError(`GitHub: ${(data as { message?: string }).message || res.statusText}`, res.status);
  return data as T;
}
