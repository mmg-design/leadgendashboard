"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Code2, ExternalLink, GitBranch, Globe, Layers, Loader2, RefreshCw, X } from "lucide-react";

// "Where is this website built?" in a client's settings. The answer decides
// how agents work on the site: custom code on GitHub (the agent changes the
// code and opens a pull request with a preview), Webflow, or something else
// (drafts only). The GitHub side connects the dashboard's GitHub app, picks
// the repo and sets the agent up there, with a checklist of where it stands.

export type Platform = "github" | "webflow" | "other";

const OPTIONS: { value: Platform; label: string; hint: string; Icon: typeof Code2 }[] = [
  { value: "github", label: "Custom code", hint: "On GitHub (Astro, Next.js…)", Icon: Code2 },
  { value: "webflow", label: "Webflow", hint: "Built in Webflow", Icon: Layers },
  { value: "other", label: "Something else", hint: "WordPress, Squarespace…", Icon: Globe },
];

export function PlatformPicker({ value, onChange, compact = false }: { value: Platform | null; onChange: (p: Platform) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Where is this website built?" className={`grid gap-2 ${compact ? "sm:grid-cols-3" : "md:grid-cols-3"}`}>
      {OPTIONS.map(({ value: v, label, hint, Icon }) => {
        const on = value === v;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onChange(v)}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${on ? "border-[#0CA4C3] bg-[#0CA4C3]/[0.06] shadow-[0_2px_10px_rgba(12,164,195,0.15)]" : "border-border bg-white hover:border-[#0CA4C3]/40"}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${on ? "bg-[#0CA4C3] text-white" : "bg-[#001A2E]/[0.05] text-[#1D475E]"}`}><Icon size={16} /></span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-[#001A2E]">{label}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface AppInfo { slug: string; installed: boolean; installUrl: string; manageUrl: string | null; owner: string | null }
interface Repo { fullName: string; private: boolean; defaultBranch: string; pushedAt: string | null }
interface Status {
  info: { repo: string; defaultBranch: string; private: boolean; dir: string; framework: string | null; packageManager: string; preview: string; previewTemplate: string | null };
  workflow: "missing" | "outdated" | "current";
  prompt: boolean;
  secret: boolean | null;
  setupPr: { number: number; url: string; state: "open" | "merged" | "closed" } | null;
  ready: boolean;
}

const PREVIEW: Record<string, string> = { "cloudflare-workers": "Cloudflare Workers", "cloudflare-pages": "Cloudflare Pages", vercel: "Vercel", unknown: "Not found yet" };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

function Row({ ok, warn, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[14px] text-[#01384C]">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? "bg-emerald-100 text-emerald-700" : warn ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
        {ok ? <Check size={12} /> : warn ? <AlertTriangle size={11} /> : <X size={11} />}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export function GitHubSetup({ clientSlug, notice }: { clientSlug: string; notice?: string | null }) {
  const [conn, setConn] = useState<{ app: AppInfo | null; access: boolean; viaToken: boolean } | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        call<{ app: AppInfo | null; access: boolean; viaToken: boolean }>("/api/github"),
        call<{ repo: string | null; status: Status | null; error?: string }>(`/api/github/setup?client=${encodeURIComponent(clientSlug)}`),
      ]);
      setConn(c); setRepo(s.repo); setStatus(s.status);
      setError(s.error || null);
      if (c.access && !s.repo) {
        const r = await call<{ repos: Repo[] | null; error: string | null }>("/api/github?repos=1");
        setRepos(r.repos || []);
        if (r.error) setError(r.error);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load GitHub."); }
  }, [clientSlug]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function act(action: "setup" | "merge" | "disconnect", body: Record<string, unknown> = {}) {
    setBusy(action); setError(null);
    try {
      const d = await call<{ repo: string | null; status: Status | null }>("/api/github/setup", { method: "POST", body: JSON.stringify({ client: clientSlug, action, ...body }) });
      setRepo(d.repo); setStatus(d.status);
      if (action === "disconnect") await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    setBusy(null);
  }

  const connectHref = `/api/github/app/create?return=${encodeURIComponent(`/${clientSlug}`)}`;
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60";
  const primary = `${btn} bg-[#0CA4C3] text-white shadow-[0_2px_6px_rgba(12,164,195,0.3)] hover:bg-[#0394B2]`;
  const secondary = `${btn} border border-border bg-white text-[#01384C] hover:bg-slate-50`;

  if (!conn) return <div className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Checking GitHub…</div>;

  return (
    <div className="space-y-3">
      {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{notice}</p>}

      {!conn.access ? (
        <div className="space-y-2">
          <p className="text-[14px] text-[#01384C]">
            {conn.app ? "The dashboard's GitHub app exists but isn't installed yet. Install it and choose the repos it can reach." : "Connect GitHub once and the dashboard can set up its agent in any client repo you choose. You'll click Create on GitHub, then pick the repos."}
          </p>
          <a href={connectHref} className={primary}><GitBranch size={14} /> {conn.app ? "Install on GitHub" : "Connect GitHub"}</a>
        </div>
      ) : !repo ? (
        <div className="space-y-2">
          <label className="block text-[14px] font-medium text-foreground/70">Which repo is this site?</label>
          {!repos ? <div className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading repos…</div> : (
            <div className="flex flex-wrap items-center gap-2">
              <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-[240px] flex-1 rounded-lg border border-border bg-white px-3 py-2 text-[15px]">
                <option value="">Pick a repo</option>
                {repos.map((r) => <option key={r.fullName} value={r.fullName}>{r.fullName}{r.private ? " (private)" : ""}</option>)}
              </select>
              <button type="button" disabled={!pick || !!busy} onClick={() => act("setup", { repo: pick })} className={primary}>
                {busy === "setup" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Connect and set up
              </button>
            </div>
          )}
          <p className="text-[12px] text-[#097388]/75">
            Connecting looks at how the site is built, gives the repo the agent&apos;s Anthropic key, and opens one setup pull request.
            {conn.app?.manageUrl && <> Don&apos;t see the repo? <a href={conn.app.manageUrl} target="_blank" rel="noreferrer" className="underline">Choose repos on GitHub</a>.</>}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-[#001A2E] hover:underline">
              <GitBranch size={15} /> {repo} <ExternalLink size={12} className="text-muted-foreground" />
            </a>
            {status?.ready ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700"><Check size={12} /> Agent ready</span>
            ) : status ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-800">Setup not finished</span>
            ) : null}
          </div>
          {status ? (
            <ul className="space-y-1.5">
              <Row ok>Site {status.info.dir ? <>in <code className="rounded bg-slate-100 px-1 text-[13px]">{status.info.dir}/</code></> : "at the repo root"}{status.info.framework ? `, built with ${status.info.framework === "next" ? "Next.js" : status.info.framework[0].toUpperCase() + status.info.framework.slice(1)}` : ""} ({status.info.packageManager})</Row>
              <Row ok={status.info.preview !== "unknown"} warn={status.info.preview === "unknown"}>
                Previews: {PREVIEW[status.info.preview] || status.info.preview}
                {status.info.preview === "cloudflare-workers" && !status.info.previewTemplate && <span className="text-muted-foreground"> (preview links show once the first run finishes)</span>}
                {status.info.preview === "unknown" && <span className="text-muted-foreground"> (the agent still works; you&apos;ll review the pull request instead)</span>}
              </Row>
              <Row ok={status.secret === true} warn={status.secret === null}>
                {status.secret === true ? "Anthropic key set in the repo" : status.secret === null ? "Couldn't check the repo's Anthropic key" : "Anthropic key not set yet"}
              </Row>
              <Row ok={status.workflow === "current" && status.prompt} warn={status.workflow === "outdated"}>
                {status.workflow === "current" && status.prompt ? "Agent workflow installed" : status.workflow === "outdated" ? "Agent workflow update available" : "Agent workflow not installed yet"}
                {status.setupPr?.state === "open" && <> · <a href={status.setupPr.url} target="_blank" rel="noreferrer" className="font-medium text-[#0394B2] hover:underline">setup pull request #{status.setupPr.number}</a></>}
              </Row>
            </ul>
          ) : (
            <p className="text-[14px] text-muted-foreground">{busy ? "Working…" : "Couldn't read the repo just now."}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {status?.setupPr?.state === "open" && (
              <button type="button" disabled={!!busy} onClick={() => act("merge")} className={primary}>
                {busy === "merge" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Finish setup (merge)
              </button>
            )}
            {status && status.setupPr?.state !== "open" && (!status.ready || status.workflow === "outdated") && (
              <button type="button" disabled={!!busy} onClick={() => act("setup", { repo })} className={primary}>
                {busy === "setup" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {status.workflow === "outdated" ? "Update the agent" : "Set up the agent"}
              </button>
            )}
            <button type="button" disabled={!!busy} onClick={load} className={secondary}><RefreshCw size={13} /> Check again</button>
            <button type="button" disabled={!!busy} onClick={() => { if (confirm(`Stop using ${repo} for this client? Nothing in the repo changes.`)) act("disconnect"); }} className={`${btn} text-muted-foreground hover:text-red-600`}>Change repo</button>
          </div>
          {status?.setupPr?.state === "open" && <p className="text-[12px] text-[#097388]/75">Merging the setup pull request only adds the agent&apos;s files. Nothing changes on the live site.</p>}
        </div>
      )}
      {conn.viaToken && <p className="text-[12px] text-[#097388]/75">Using the GITHUB_AGENT_TOKEN for now. <a href={connectHref} className="underline">Connect the GitHub app</a> to reach more repos.</p>}
      {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
    </div>
  );
}
