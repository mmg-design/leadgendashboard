"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Bot, Check, ChevronDown, ClipboardCopy, ExternalLink, FileSearch, Globe, Loader2, RefreshCw,
  RotateCcw, Search, Send, Sparkles, Wrench, X,
} from "lucide-react";
import type { ScanSummary, StoredTask, TaskCategory } from "@/lib/agent-tasks";
import type { AgentOutput } from "@/lib/agent-runner";
import type { WfCollection } from "@/lib/webflow";
import { safeHtml } from "@/lib/safe-html";
import { lighten } from "@/lib/source-colors";

interface AgentsResponse {
  tasks: StoredTask[];
  scan: ScanSummary | null;
  model: string | null;
  webflow: { connected: boolean; siteName?: string | null };
  clickup: boolean;
  error?: string;
}

// Category colors come from the dashboard's colorblind-checked palette and are
// always shown with an icon and a name.
const CATEGORIES: Record<TaskCategory, { label: string; color: string; Icon: typeof Bot; blurb: string }> = {
  ai: { label: "AI visibility", color: "#4a3aa7", Icon: Sparkles, blurb: "Get named by ChatGPT, Google AI and Perplexity" },
  indexing: { label: "Indexing", color: "#eb6834", Icon: FileSearch, blurb: "Pages Google can't show yet" },
  search: { label: "Search growth", color: "#2a78d6", Icon: Search, blurb: "Rankings and clicks within reach" },
  upkeep: { label: "Site upkeep", color: "#1baf7a", Icon: Wrench, blurb: "On-page basics and visitor friction" },
};
const CATEGORY_ORDER: TaskCategory[] = ["ai", "indexing", "search", "upkeep"];
const IMPACT_RANK = { high: 0, medium: 1, low: 2 };

const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const input = "w-full px-3 py-2 text-[14px] border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#001A2E]/15 focus:border-[#001A2E]/30";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3.5 py-2 text-[14px] font-medium text-white hover:bg-[#0394B2] disabled:opacity-50 transition-colors";
const btnSecondary = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[14px] font-medium text-[#001A2E] hover:bg-muted/50 disabled:opacity-50 transition-colors";
const btnGhost = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[14px] font-medium text-muted-foreground hover:text-[#001A2E] hover:bg-muted/50 disabled:opacity-50 transition-colors";

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-[#0394B2] hover:bg-[#0CA4C3]/10"
    >
      {done ? <Check size={12} /> : <ClipboardCopy size={12} />}
      {done ? "Copied" : label}
    </button>
  );
}

function Block({ title, copy, children }: { title: string; copy?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={eyebrow}>{title}</p>
        {copy && <CopyButton text={copy} />}
      </div>
      {children}
    </div>
  );
}

function CategoryChip({ category }: { category: TaskCategory }) {
  const c = CATEGORIES[category];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: lighten(c.color, 0.88), color: "#001A2E" }}>
      <c.Icon size={12} style={{ color: c.color }} />
      {c.label}
    </span>
  );
}

function ImpactChip({ impact }: { impact: StoredTask["impact"] }) {
  const styles = { high: "bg-[#001A2E] text-white", medium: "bg-[#001A2E]/10 text-[#001A2E]", low: "bg-muted text-muted-foreground" };
  return <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${styles[impact]}`}>{impact === "high" ? "High impact" : impact === "medium" ? "Medium impact" : "Low impact"}</span>;
}

const STATUS_TEXT: Record<StoredTask["status"], string> = {
  open: "", drafted: "Draft ready", applied: "Applied", done: "Done", dismissed: "Dismissed", resolved: "Resolved on its own",
};

// ── Agent output ────────────────────────────────────────────────────────────

type Post = (body: Record<string, unknown>) => Promise<{ ok?: boolean; error?: string; result?: Record<string, unknown> } & Record<string, unknown>>;

function SeoEditor({ task, out, post, webflowConnected, onResult }: {
  task: StoredTask; out: AgentOutput; post: Post; webflowConnected: boolean; onResult: (r: Record<string, unknown>, status?: StoredTask["status"]) => void;
}) {
  const [title, setTitle] = useState(out.seo?.title || "");
  const [desc, setDesc] = useState(out.seo?.metaDescription || "");
  const [busy, setBusy] = useState<"" | "apply" | "publish">("");
  const [error, setError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const applied = task.result?.webflow as { applied?: { title: string }; previous?: { title: string; description: string }; published?: boolean; kind?: string; collectionName?: string } | undefined;

  async function apply() {
    setBusy("apply"); setError(null);
    const res = await post({ action: "webflow_seo", title, description: desc });
    setBusy("");
    if (res.error) setError(res.error); else onResult(res.result!, "applied");
  }
  async function publish() {
    setBusy("publish"); setError(null); setConfirmPublish(false);
    const res = await post({ action: "webflow_publish" });
    setBusy("");
    if (res.error) setError(res.error); else onResult(res.result!, "done");
  }

  return (
    <Block title="Search snippet">
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="font-medium text-foreground/70">Title tag</span>
            <span className={title.length > 60 ? "text-amber-700" : "text-muted-foreground"}>{title.length}/60 <CopyButton text={title} /></span>
          </div>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="font-medium text-foreground/70">Meta description</span>
            <span className={desc.length > 158 ? "text-amber-700" : "text-muted-foreground"}>{desc.length}/155 <CopyButton text={desc} /></span>
          </div>
          <textarea className={`${input} min-h-[64px]`} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        {out.seo?.h1 && (
          <p className="text-[13px] text-muted-foreground">H1: <span className="text-[#001A2E]">{out.seo.h1}</span> <CopyButton text={out.seo.h1} /></p>
        )}

        {/* Google preview */}
        <div className="rounded-lg bg-muted/40 px-3 py-2.5">
          <p className="text-[12px] text-muted-foreground truncate">{task.url || task.path}</p>
          <p className="text-[17px] leading-snug text-[#1a0dab] truncate">{title || "(no title)"}</p>
          <p className="text-[13px] text-[#4d5156] line-clamp-2">{desc}</p>
        </div>

        {task.path && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {webflowConnected ? (
              applied?.published ? (
                <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-emerald-700"><Check size={14} /> Live on the site</span>
              ) : applied ? (
                confirmPublish ? (
                  <>
                    <span className="text-[14px] text-[#001A2E]">Publish {task.path} to the live site?</span>
                    <button className={btnPrimary} onClick={publish}>Yes, publish</button>
                    <button className={btnGhost} onClick={() => setConfirmPublish(false)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[14px] text-[#001A2E]"><Check size={14} className="text-emerald-600" /> Staged in Webflow{applied.kind === "item" ? ` (${applied.collectionName} item)` : ""}</span>
                    <button className={btnPrimary} disabled={!!busy} onClick={() => setConfirmPublish(true)}>
                      {busy === "publish" ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} Publish this page
                    </button>
                    <button className={btnGhost} disabled={!!busy} onClick={apply}>Update staged text</button>
                  </>
                )
              ) : (
                <button className={btnPrimary} disabled={!!busy || !title || !desc} onClick={apply}>
                  {busy === "apply" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Apply to Webflow
                </button>
              )
            ) : (
              <span className="text-[13px] text-muted-foreground">Connect Webflow in Settings to apply this with one click.</span>
            )}
          </div>
        )}
        {applied?.previous && (
          <p className="text-[12px] text-muted-foreground">Before: “{applied.previous.title || "(empty)"}” · “{applied.previous.description || "(empty)"}”</p>
        )}
        {error && <p className="text-[13px] text-red-600">{error}</p>}
      </div>
    </Block>
  );
}

function DraftCreator({ task, out, post, webflowConnected, onResult }: {
  task: StoredTask; out: AgentOutput; post: Post; webflowConnected: boolean; onResult: (r: Record<string, unknown>, status?: StoredTask["status"]) => void;
}) {
  const [collections, setCollections] = useState<WfCollection[] | null>(null);
  const [collectionId, setCollectionId] = useState("");
  const [slug, setSlug] = useState(out.newPage?.slug || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = task.result?.draft as { mapped?: string[]; unmappedRequired?: string[] } | undefined;

  async function load() {
    setBusy(true); setError(null);
    const res = await post({ action: "webflow_lookup" });
    setBusy(false);
    if (res.error) return setError(res.error);
    const list = (res.collections as WfCollection[]) || [];
    setCollections(list);
    const guess = list.find((c) => /blog|post|article|resource|insight|news/i.test(`${c.slug} ${c.displayName}`));
    setCollectionId(guess?.id || list[0]?.id || "");
  }
  async function create() {
    setBusy(true); setError(null);
    const res = await post({ action: "webflow_draft", collectionId, slug, title: out.seo?.title, description: out.seo?.metaDescription });
    setBusy(false);
    if (res.error) setError(res.error); else onResult(res.result!, "applied");
  }

  if (!webflowConnected) return <p className="text-[13px] text-muted-foreground">Connect Webflow in Settings to create this as a draft CMS item with one click.</p>;
  if (draft) {
    return (
      <div className="text-[14px] text-[#001A2E] space-y-1">
        <p className="inline-flex items-center gap-1.5"><Check size={14} className="text-emerald-600" /> Draft created in Webflow. Review it in the CMS, add an image, and publish it there.</p>
        {!!draft.unmappedRequired?.length && <p className="text-[13px] text-amber-700">Fill in before publishing: {draft.unmappedRequired.join(", ")}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {collections === null ? (
        <button className={btnPrimary} disabled={busy} onClick={load}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Create Webflow draft
        </button>
      ) : (
        <>
          <select className={`${input} w-auto`} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </select>
          <span className="text-[13px] text-muted-foreground">/</span>
          <input className={`${input} w-56`} value={slug} onChange={(e) => setSlug(e.target.value)} />
          <button className={btnPrimary} disabled={busy || !collectionId || !slug} onClick={create}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create draft
          </button>
          <span className="text-[12px] text-muted-foreground">Saved as a draft. Nothing goes live.</span>
        </>
      )}
      {error && <p className="w-full text-[13px] text-red-600">{error}</p>}
    </div>
  );
}

const proseHtml = "text-[14px] leading-relaxed text-[#001A2E] [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-[#0394B2] [&_a]:underline";

function OutputView({ task, out, post, webflowConnected, onResult }: {
  task: StoredTask; out: AgentOutput; post: Post; webflowConnected: boolean; onResult: (r: Record<string, unknown>, status?: StoredTask["status"]) => void;
}) {
  const showSeoEditor = !!out.seo?.title && task.type !== "missing_page" && !(task.type === "ai_prompt" && out.targetPage === "new");
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-[#0CA4C3]/[0.06] border border-[#0CA4C3]/25 px-4 py-3">
        <p className="text-[14px] text-[#01384C]">{out.summary}</p>
        <p className="mt-1 text-[12px] text-[#097388]/80">Drafted by {out.model} · {timeAgo(out.generatedAt)}</p>
      </div>

      {showSeoEditor && <SeoEditor task={task} out={out} post={post} webflowConnected={webflowConnected} onResult={onResult} />}

      {out.newPage?.bodyHtml && (
        <Block title={task.type === "ai_prompt" && out.targetPage && out.targetPage !== "new" ? `Content to add to ${out.targetPage}` : "New page"} copy={out.newPage.bodyHtml}>
          {(!showSeoEditor && out.seo?.title) && (
            <div className="mb-3 space-y-0.5 text-[13px]">
              <p><span className="text-muted-foreground">Title:</span> {out.seo.title} <CopyButton text={out.seo.title} /></p>
              <p><span className="text-muted-foreground">Meta:</span> {out.seo.metaDescription} <CopyButton text={out.seo.metaDescription} /></p>
              <p><span className="text-muted-foreground">H1:</span> {out.seo.h1}</p>
            </div>
          )}
          <div className={`${proseHtml} max-h-[420px] overflow-y-auto rounded-lg border border-border/60 px-4 py-2`} dangerouslySetInnerHTML={{ __html: safeHtml(out.newPage.bodyHtml) }} />
          {(task.type === "missing_page" || out.targetPage === "new") && (
            <div className="mt-3"><DraftCreator task={task} out={out} post={post} webflowConnected={webflowConnected} onResult={onResult} /></div>
          )}
        </Block>
      )}

      {!!out.sections?.length && (
        <Block title="Sections to add" copy={out.sections.map((s) => `## ${s.heading}\n\n${s.body}`).join("\n\n")}>
          <div className="space-y-3">
            {out.sections.map((s, i) => (
              <div key={i}>
                <p className="text-[15px] font-semibold text-[#001A2E]">{s.heading}</p>
                <p className="whitespace-pre-line text-[14px] text-[#001A2E]/85">{s.body}</p>
              </div>
            ))}
          </div>
        </Block>
      )}

      {!!out.faq?.length && (
        <Block title="FAQs" copy={out.faq.map((f) => `${f.question}\n${f.answer}`).join("\n\n")}>
          <div className="space-y-2.5">
            {out.faq.map((f, i) => (
              <div key={i}>
                <p className="text-[14px] font-semibold text-[#001A2E]">{f.question}</p>
                <p className="text-[14px] text-[#001A2E]/80">{f.answer}</p>
              </div>
            ))}
          </div>
        </Block>
      )}

      {!!out.internalLinks?.length && (
        <Block title="Internal links to add">
          <ul className="space-y-1 text-[14px]">
            {out.internalLinks.map((l, i) => <li key={i}>From <span className="font-medium">{l.fromPage}</span>, link the words “{l.anchorText}” to {task.path}</li>)}
          </ul>
        </Block>
      )}

      {!!out.schemaJsonLd?.trim() && (
        <Block title="Structured data (JSON-LD)" copy={`<script type="application/ld+json">\n${out.schemaJsonLd}\n</script>`}>
          <pre className="max-h-[220px] overflow-auto rounded-lg bg-[#001A2E] p-3 text-[12px] leading-relaxed text-white/90">{out.schemaJsonLd}</pre>
          <p className="mt-1.5 text-[12px] text-muted-foreground">Copy includes the script tag. In Webflow: Page settings, Custom code, Inside &lt;head&gt; tag.</p>
        </Block>
      )}

      {!!out.outreach?.length && (
        <Block title="Outreach">
          <div className="space-y-3">
            {out.outreach.map((o, i) => (
              <div key={i} className="rounded-lg border border-border/60 p-3">
                <p className="text-[14px] font-semibold text-[#001A2E]">{o.target}</p>
                <p className="text-[14px] text-[#001A2E]/80">{o.approach}</p>
                {o.pitchBody && (
                  <div className="mt-2 rounded-lg bg-muted/40 p-3">
                    <div className="flex items-center justify-between">
                      {o.pitchSubject ? <p className="text-[13px] font-medium">Subject: {o.pitchSubject}</p> : <span />}
                      <CopyButton text={`${o.pitchSubject ? `Subject: ${o.pitchSubject}\n\n` : ""}${o.pitchBody}`} />
                    </div>
                    <p className="mt-1 whitespace-pre-line text-[13px] text-[#001A2E]/85">{o.pitchBody}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Block>
      )}

      {!!out.findings?.length && (
        <Block title="What's going wrong">
          <div className="space-y-2.5">
            {out.findings.map((f, i) => (
              <div key={i} className="text-[14px]">
                <p className="font-semibold text-[#001A2E]">{f.issue}</p>
                <p className="text-[#001A2E]/80"><span className="text-muted-foreground">Likely cause:</span> {f.likelyCause}</p>
                <p className="text-[#001A2E]/80"><span className="text-muted-foreground">Fix:</span> {f.fix}</p>
              </div>
            ))}
          </div>
        </Block>
      )}

      {!!out.steps?.length && (
        <Block title="Steps" copy={out.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? `: ${s.detail}` : ""}`).join("\n")}>
          <ol className="space-y-2">
            {out.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[14px]">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#001A2E]/[0.07] text-[12px] font-semibold text-[#001A2E]">{i + 1}</span>
                <span><span className="font-medium text-[#001A2E]">{s.title}</span>{s.detail && <span className="text-[#001A2E]/75"> {s.detail}</span>}</span>
              </li>
            ))}
          </ol>
        </Block>
      )}
    </div>
  );
}

// ── Task card ───────────────────────────────────────────────────────────────

function TaskCard({ task, clientSlug, webflowConnected, clickupConnected, onChange }: {
  task: StoredTask; clientSlug: string; webflowConnected: boolean; clickupConnected: boolean; onChange: (t: StoredTask) => void;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const out = task.output as AgentOutput | null;
  const isIndexing = task.type === "indexing";
  const inspectLink = (task.data?.status as { inspectUrl?: string } | undefined)?.inspectUrl;
  const clickupTask = task.result?.clickup as { url?: string } | undefined;
  const sitemap = task.result?.sitemap as { submitted?: string[] } | undefined;

  const post: Post = async (body) => {
    const res = await fetch("/api/agents/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: clientSlug, key: task.key, ...body }),
    });
    return res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  };

  function onResult(result: Record<string, unknown>, status?: StoredTask["status"]) {
    onChange({ ...task, result, ...(status ? { status } : {}) });
  }

  async function run() {
    setRunning(true); setError(null); setOpen(true);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug, key: task.key }),
      });
      const json = await res.json().catch(() => ({ error: "The agent took too long to answer. Try again." }));
      if (json.ok) onChange({ ...task, output: json.output, status: json.status });
      else setError(json.error || "The agent hit an error.");
    } catch {
      setError("Lost connection while the agent was working. Try again.");
    } finally {
      setRunning(false);
    }
  }

  async function setStatus(status: StoredTask["status"]) {
    setBusy(status);
    await fetch("/api/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: clientSlug, key: task.key, status }) });
    setBusy(null);
    onChange({ ...task, status });
  }

  async function action(name: "clickup" | "resubmit_sitemap") {
    setBusy(name); setError(null);
    const res = await post({ action: name });
    setBusy(null);
    if (res.error) setError(res.error); else onResult(res.result!);
  }

  const closed = task.status === "done" || task.status === "dismissed" || task.status === "resolved";

  return (
    <Card className={closed ? "opacity-75" : ""}>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-4">
          <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)}>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <CategoryChip category={task.category} />
              <ImpactChip impact={task.impact} />
              {STATUS_TEXT[task.status] && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">{STATUS_TEXT[task.status]}</span>
              )}
            </div>
            <p className="text-[17px] font-semibold leading-snug text-[#001A2E]">{task.title}</p>
            <p className="mt-1 text-[14px] text-[#001A2E]/70">{task.why}</p>
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            {!closed && !out && (
              <button className={btnPrimary} disabled={running} onClick={run}>
                {running ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
                {running ? "Working…" : isIndexing ? "Diagnose" : "Run agent"}
              </button>
            )}
            <button className={btnGhost} onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
              <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>

        {open && (
          <div className="space-y-4 border-t border-border/60 pt-4">
            <div>
              <p className={`${eyebrow} mb-1.5`}>Evidence</p>
              <ul className="space-y-1 text-[14px] text-[#001A2E]/80">
                {task.evidence.map((e, i) => <li key={i} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-[#001A2E]/40" />{e}</li>)}
              </ul>
              {task.url && (
                <a href={task.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] text-[#0394B2] hover:underline">
                  Open the page <ExternalLink size={12} />
                </a>
              )}
            </div>

            {running && (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#0CA4C3]/40 bg-[#0CA4C3]/[0.04] px-4 py-5 text-[14px] text-[#01384C]">
                <Loader2 size={16} className="animate-spin text-[#0CA4C3]" />
                {isIndexing ? "Checking the live page…" : "The agent is reading the page and the data, then drafting. Usually 30 to 90 seconds."}
              </div>
            )}

            {out && !running && <OutputView task={task} out={out} post={post} webflowConnected={webflowConnected} onResult={onResult} />}

            {isIndexing && (
              <div className="flex flex-wrap items-center gap-2">
                <button className={btnSecondary} disabled={!!busy} onClick={() => action("resubmit_sitemap")}>
                  {busy === "resubmit_sitemap" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Resubmit sitemap
                </button>
                {inspectLink && (
                  <a href={inspectLink} target="_blank" rel="noreferrer" className={btnSecondary}>
                    Request indexing in Google <ExternalLink size={13} />
                  </a>
                )}
                {sitemap?.submitted && <span className="text-[13px] text-emerald-700">Resubmitted {sitemap.submitted.length} sitemap{sitemap.submitted.length === 1 ? "" : "s"}</span>}
              </div>
            )}

            {error && <p className="text-[14px] text-red-600">{error}</p>}

            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
              {out && !closed && (
                <button className={btnGhost} disabled={running} onClick={run}><RotateCcw size={14} /> Run again</button>
              )}
              {clickupConnected && (
                clickupTask?.url ? (
                  <a href={clickupTask.url} target="_blank" rel="noreferrer" className={btnGhost}><Check size={14} className="text-emerald-600" /> In ClickUp <ExternalLink size={12} /></a>
                ) : (
                  <button className={btnGhost} disabled={!!busy} onClick={() => action("clickup")}>
                    {busy === "clickup" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to ClickUp
                  </button>
                )
              )}
              <span className="flex-1" />
              {closed ? (
                <button className={btnGhost} disabled={!!busy} onClick={() => setStatus(out ? "drafted" : "open")}><RotateCcw size={14} /> Reopen</button>
              ) : (
                <>
                  <button className={btnGhost} disabled={!!busy} onClick={() => setStatus("dismissed")}><X size={14} /> Dismiss</button>
                  <button className={btnSecondary} disabled={!!busy} onClick={() => setStatus("done")}><Check size={14} /> Mark done</button>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────────────

export function AgentsTab({ clientSlug, clientName }: { clientSlug: string; clientName: string }) {
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<TaskCategory | "all">("all");
  const [view, setView] = useState<"active" | "closed">("active");

  function load(scan = false) {
    fetch(`/api/agents?client=${clientSlug}${scan ? "&scan=1" : ""}`)
      .then((r) => r.json())
      .then((json: AgentsResponse) => {
        if (json.error) setError(json.error);
        else { setError(null); setData(json); }
      })
      .catch(() => setError("Couldn't load agent tasks."))
      .finally(() => { setLoading(false); setScanning(false); });
  }
  useEffect(() => { load(); }, [clientSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  function rescan() {
    setScanning(true);
    load(true);
  }

  const tasks = useMemo(() => data?.tasks || [], [data]);
  const isActive = (t: StoredTask) => t.status === "open" || t.status === "drafted" || t.status === "applied";
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tasks) if (isActive(t)) c[t.category] = (c[t.category] || 0) + 1;
    return c;
  }, [tasks]);
  const shown = tasks
    .filter((t) => (view === "active" ? isActive(t) : !isActive(t)))
    .filter((t) => category === "all" || t.category === category)
    .sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || b.score - a.score);
  const closedCount = tasks.filter((t) => !isActive(t)).length;

  function replace(updated: StoredTask) {
    setData((d) => (d ? { ...d, tasks: d.tasks.map((t) => (t.key === updated.key ? updated : t)) } : d));
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0394B2] mb-1.5">Agents</div>
          <h2 className="font-headline text-[28px] text-[#001A2E]">Work queue for {clientName}</h2>
          <p className="mt-1 max-w-[720px] text-[15px] text-muted-foreground">
            Agents scan Search Console, SE Ranking, the AI tracker, Clarity and the live site, then turn what they find into tasks.
            Run an agent to get a ready-to-ship draft; nothing changes on the site until you apply and publish it.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data?.scan && <span className="text-[13px] text-muted-foreground">Scanned {timeAgo(data.scan.scannedAt)}</span>}
          <button className={btnSecondary} disabled={scanning || loading} onClick={rescan}>
            <RefreshCw size={14} className={scanning ? "animate-spin" : ""} /> {scanning ? "Scanning…" : "Scan again"}
          </button>
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="py-14 flex items-center justify-center gap-2 text-[15px] text-muted-foreground"><Loader2 size={17} className="animate-spin" /> Scanning the site and its data. The first scan takes up to a minute…</CardContent></Card>
      ) : error && !data ? (
        <Card><CardContent className="py-10 text-center text-[15px] text-muted-foreground">{error}</CardContent></Card>
      ) : data && (
        <>
          {/* Connections */}
          <div className="flex flex-wrap items-center gap-2 px-1 text-[13px]">
            {data.scan?.sources.map((s) => (
              <span key={s.name} title={s.note} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${s.ok ? "border-border bg-white text-[#001A2E]" : "border-dashed border-border text-muted-foreground"}`}>
                {s.ok ? <Check size={12} className="text-emerald-600" /> : <X size={12} />}
                {s.name}
              </span>
            ))}
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${data.webflow.connected ? "border-border bg-white text-[#001A2E]" : "border-dashed border-border text-muted-foreground"}`}>
              {data.webflow.connected ? <Check size={12} className="text-emerald-600" /> : <X size={12} />}
              Webflow{data.webflow.siteName ? `: ${data.webflow.siteName}` : " (add a site token in Settings to apply changes)"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2.5 py-1 text-[#001A2E]">
              <Bot size={12} className="text-[#0394B2]" /> {data.model || "No AI key set"}
            </span>
          </div>

          {/* Category summary */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {CATEGORY_ORDER.map((key) => {
              const c = CATEGORIES[key];
              const active = category === key;
              return (
                <button
                  key={key}
                  onClick={() => setCategory(active ? "all" : key)}
                  className={`rounded-2xl border bg-white p-4 text-left transition-shadow ${active ? "border-[#001A2E]/40 shadow-[0_4px_16px_rgba(0,26,46,0.08)]" : "border-border hover:shadow-[0_4px_16px_rgba(0,26,46,0.05)]"}`}
                  style={{ backgroundImage: `linear-gradient(135deg, ${lighten(c.color, 0.93)}, #ffffff 70%)` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg" style={{ background: lighten(c.color, 0.82) }}>
                      <c.Icon size={16} style={{ color: c.color }} />
                    </span>
                    <span className="text-[15px] font-semibold text-[#001A2E]">{c.label}</span>
                  </div>
                  <p className="mt-3 font-headline text-[32px] leading-none text-[#001A2E]">{counts[key] || 0}</p>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{c.blurb}</p>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 px-1">
            {(["active", "closed"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-1.5 text-[14px] font-medium ${view === v ? "bg-white border border-border text-[#001A2E] shadow-sm" : "text-muted-foreground hover:text-[#001A2E]"}`}
              >
                {v === "active" ? `To do (${tasks.length - closedCount})` : `Done & dismissed (${closedCount})`}
              </button>
            ))}
            {category !== "all" && (
              <button className={btnGhost} onClick={() => setCategory("all")}><X size={13} /> {CATEGORIES[category].label}</button>
            )}
          </div>

          {shown.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-[15px] text-muted-foreground">
              {view === "active" ? "Nothing to do here right now. The next scan runs automatically in 12 hours." : "Nothing finished yet."}
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              {shown.map((t) => (
                <TaskCard key={t.key} task={t} clientSlug={clientSlug} webflowConnected={data.webflow.connected} clickupConnected={data.clickup} onChange={replace} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
