import sodium from "libsodium-wrappers";
import { GitHubApiError, ghApi } from "./github-app";
import { PROMPT_PATH, WORKFLOW_PATH, WORKFLOW_VERSION, promptFile, workflowFile, type PackageManager } from "./agent-workflow";

// Getting a client's repo ready for the agent: work out where the site lives
// and how it's built and previewed, give the repo the agent's Anthropic key,
// and open one "set up the MMG Studio agent" pull request with the workflow.
// Merging that pull request (from settings or GitHub) finishes the setup.

export const SETUP_BRANCH = "mmg-agent-setup";

export type PreviewHost = "cloudflare-workers" | "cloudflare-pages" | "vercel" | "unknown";

export interface RepoInfo {
  repo: string;
  defaultBranch: string;
  private: boolean;
  dir: string; // "" = repo root
  framework: string | null;
  packageManager: PackageManager;
  nodeVersion: string;
  preview: PreviewHost;
  previewTemplate: string | null; // for Cloudflare Workers sites
}

export interface SetupStatus {
  info: RepoInfo;
  workflow: "missing" | "outdated" | "current";
  prompt: boolean;
  secret: boolean | null; // null = couldn't check
  setupPr: { number: number; url: string; state: "open" | "merged" | "closed" } | null;
  ready: boolean;
}

export class SetupError extends Error {}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

async function fileAt(repo: string, path: string, ref: string): Promise<{ text: string; sha: string } | null> {
  try {
    const f = await ghApi<{ content?: string; sha: string }>(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    return { text: f.content ? unb64(f.content) : "", sha: f.sha };
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  }
}

// ── Looking at a repo ───────────────────────────────────────────────────────

export async function inspectRepo(repo: string, clientDomain: string, dirOverride?: string): Promise<RepoInfo> {
  const meta = await ghApi<{ default_branch: string; private: boolean }>(`/repos/${repo}`);
  const branch = meta.default_branch;
  const tree = await ghApi<{ tree: { path: string; type: string }[] }>(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const paths = new Set(tree.tree.filter((t) => t.type === "blob").map((t) => t.path));
  const inDir = (dir: string, f: string) => (dir ? `${dir}/${f}` : f);
  const isSite = (dir: string) => [...paths].some((p) => new RegExp(`^${dir ? `${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/` : ""}(astro|next|nuxt|vite|svelte)\\.config\\.[a-z]+$`).test(p));

  // The site's folder: the root if it has a package.json and a site config,
  // otherwise the shallowest folder that does.
  let dir = dirOverride ?? "";
  if (dirOverride === undefined) {
    const candidates = [...paths].filter((p) => p.endsWith("package.json") && !p.includes("node_modules/") && p.split("/").length <= 3)
      .map((p) => p.split("/").slice(0, -1).join("/"))
      .sort((a, b) => a.split("/").length - b.split("/").length);
    dir = candidates.find((d) => isSite(d)) ?? candidates[0] ?? "";
  }

  const pkgFile = await fileAt(repo, inDir(dir, "package.json"), branch);
  let framework: string | null = null;
  let nodeVersion = "22";
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: { node?: string } };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      framework = ["astro", "next", "nuxt", "@sveltejs/kit", "vite"].find((d) => deps[d]) || null;
      const major = pkg.engines?.node?.match(/(\d{2})/);
      if (major && Number(major[1]) >= 18) nodeVersion = major[1];
    } catch { /* keep the defaults */ }
  }
  const packageManager: PackageManager = paths.has(inDir(dir, "pnpm-lock.yaml")) ? "pnpm" : paths.has(inDir(dir, "yarn.lock")) ? "yarn" : "npm";

  // How previews are built: from the checks and deployments on the latest commit.
  let preview: PreviewHost = "unknown";
  const head = await ghApi<{ sha: string }>(`/repos/${repo}/commits/${encodeURIComponent(branch)}`).catch(() => null);
  if (head) {
    const checks = await ghApi<{ check_runs: { name: string; app?: { slug?: string } }[] }>(`/repos/${repo}/commits/${head.sha}/check-runs?per_page=30`).catch(() => ({ check_runs: [] }));
    if (checks.check_runs.some((c) => /^Workers Builds/i.test(c.name))) preview = "cloudflare-workers";
    else if (checks.check_runs.some((c) => /Cloudflare Pages/i.test(c.name))) preview = "cloudflare-pages";
    else if (checks.check_runs.some((c) => /vercel/i.test(c.name) || /vercel/i.test(c.app?.slug || ""))) preview = "vercel";
    if (preview === "unknown") {
      const statuses = await ghApi<{ context: string }[]>(`/repos/${repo}/commits/${head.sha}/statuses?per_page=30`).catch(() => []);
      if (statuses.some((s) => /vercel/i.test(s.context))) preview = "vercel";
    }
  }
  if (preview === "unknown" && (paths.has(inDir(dir, "vercel.json")) || paths.has("vercel.json"))) preview = "vercel";
  if (preview === "unknown" && [...paths].some((p) => /(^|\/)wrangler\.(jsonc?|toml)$/.test(p))) preview = "cloudflare-workers";

  // Workers previews live at <version>-<worker>.<account>.workers.dev; we know
  // the address when the site itself is served from workers.dev.
  const host = clientDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const previewTemplate = preview === "cloudflare-workers" && host.endsWith(".workers.dev") ? `https://{version}-${host}` : null;

  return { repo, defaultBranch: branch, private: meta.private, dir, framework, packageManager, nodeVersion, preview, previewTemplate };
}

async function setupPr(repo: string): Promise<SetupStatus["setupPr"]> {
  const owner = repo.split("/")[0];
  const pulls = await ghApi<{ number: number; html_url: string; state: string; merged_at: string | null }[]>(`/repos/${repo}/pulls?head=${owner}:${SETUP_BRANCH}&state=all&per_page=5`).catch(() => []);
  const pr = pulls[0];
  return pr ? { number: pr.number, url: pr.html_url, state: pr.state === "open" ? "open" : pr.merged_at ? "merged" : "closed" } : null;
}

async function hasSecret(repo: string): Promise<boolean | null> {
  try {
    await ghApi(`/repos/${repo}/actions/secrets/ANTHROPIC_API_KEY`);
    return true;
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return false;
    return null;
  }
}

export async function setupStatus(repo: string, clientDomain: string, dirOverride?: string): Promise<SetupStatus> {
  const info = await inspectRepo(repo, clientDomain, dirOverride);
  const [wf, prompt, secret, pr] = await Promise.all([
    fileAt(repo, WORKFLOW_PATH, info.defaultBranch),
    fileAt(repo, PROMPT_PATH, info.defaultBranch),
    hasSecret(repo),
    setupPr(repo),
  ]);
  const workflow = !wf ? "missing" : wf.text.includes(`mmg-agent-workflow: ${WORKFLOW_VERSION}`) ? "current" : "outdated";
  return { info, workflow, prompt: !!prompt, secret, setupPr: pr, ready: workflow !== "missing" && !!prompt && secret !== false };
}

// ── Setting a repo up ───────────────────────────────────────────────────────

// Gives the repo the agent's Anthropic key (the dashboard's own), encrypted
// with the repo's public key as GitHub requires.
async function setSecret(repo: string) {
  const value = process.env.ANTHROPIC_API_KEY;
  if (!value) throw new SetupError("The dashboard has no ANTHROPIC_API_KEY to give the repo. Add it in Vercel, or add the secret in the repo's settings yourself.");
  const key = await ghApi<{ key_id: string; key: string }>(`/repos/${repo}/actions/secrets/public-key`);
  await sodium.ready;
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL));
  await ghApi(`/repos/${repo}/actions/secrets/ANTHROPIC_API_KEY`, {
    method: "PUT",
    body: { encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: key.key_id },
  });
}

export async function setupRepo(repo: string, client: { name: string; domain: string }, dirOverride?: string): Promise<SetupStatus> {
  const status = await setupStatus(repo, client.domain, dirOverride);
  const { info } = status;
  if (status.secret === false) await setSecret(repo);

  const files: { path: string; content: string }[] = [];
  if (status.workflow !== "current") {
    files.push({ path: WORKFLOW_PATH, content: workflowFile({ dir: info.dir, packageManager: info.packageManager, nodeVersion: info.nodeVersion, baseBranch: info.defaultBranch }) });
  }
  // A repo's own instructions (like IPL's) are kept; new repos get the standard ones.
  if (!status.prompt) files.push({ path: PROMPT_PATH, content: promptFile({ clientName: client.name, domain: client.domain, dir: info.dir }) });

  if (files.length) {
    const open = status.setupPr?.state === "open" ? status.setupPr : null;
    if (!open) {
      // Start the setup branch fresh from the default branch.
      const base = await ghApi<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(info.defaultBranch)}`);
      await ghApi(`/repos/${repo}/git/refs/heads/${SETUP_BRANCH}`, { method: "DELETE" }).catch(() => {});
      await ghApi(`/repos/${repo}/git/refs`, { method: "POST", body: { ref: `refs/heads/${SETUP_BRANCH}`, sha: base.object.sha } });
    }
    for (const f of files) {
      const existing = await fileAt(repo, f.path, SETUP_BRANCH);
      await ghApi(`/repos/${repo}/contents/${f.path}`, {
        method: "PUT",
        body: { message: `${existing ? "Update" : "Add"} ${f.path} (MMG Studio agent)`, content: b64(f.content), branch: SETUP_BRANCH, ...(existing ? { sha: existing.sha } : {}) },
      });
    }
    if (!open) {
      await ghApi(`/repos/${repo}/pulls`, {
        method: "POST",
        body: {
          title: status.workflow === "outdated" ? "Update the MMG Studio agent" : "Set up the MMG Studio agent",
          head: SETUP_BRANCH,
          base: info.defaultBranch,
          body: [
            "Lets the MMG Studio dashboard hand tasks to its website agent for this site.",
            "",
            `- \`${WORKFLOW_PATH}\`: started only by the dashboard. Claude Code makes one task's change on an \`mmg-agent/*\` branch${info.dir ? ` (site folder \`${info.dir}/\`)` : ""}, the workflow checks \`${info.packageManager} run build\`, pushes, and waits for the preview build. The dashboard then opens a pull request for review.`,
            status.prompt ? "" : `- \`${PROMPT_PATH}\`: the agent's standing instructions for this site. Edit freely.`,
            "",
            "Guard rails: it can't edit `.github/`, package or lock files, or build and hosting config, has no web access, and never merges or deploys production. The `ANTHROPIC_API_KEY` repository secret was set by the dashboard.",
            "",
            "Merging this changes nothing on the live site.",
          ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
        },
      });
    }
  }
  return setupStatus(repo, client.domain, dirOverride);
}

// Merges the open setup pull request (the owner clicked "Finish setup").
export async function mergeSetup(repo: string): Promise<void> {
  const pr = await setupPr(repo);
  if (!pr || pr.state !== "open") throw new SetupError("There's no open setup pull request to merge.");
  await ghApi(`/repos/${repo}/pulls/${pr.number}/merge`, { method: "PUT", body: { merge_method: "squash", commit_title: "Set up the MMG Studio agent" } });
  await ghApi(`/repos/${repo}/git/refs/heads/${SETUP_BRANCH}`, { method: "DELETE" }).catch(() => {});
}
