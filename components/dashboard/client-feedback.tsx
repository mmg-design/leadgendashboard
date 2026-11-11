"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Bell, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, FileText, Files, Link2, Loader2, Mail, MessageSquare, Monitor, RefreshCw, RotateCcw,
  Search, Smartphone, Tablet, Wrench,
} from "lucide-react";
import type { Device, Feedback, FeedbackStatus } from "@/lib/feedback";
import { photoPath } from "@/lib/feedback-photo";

// A client's own feedback page: everything they've left through their review
// link, grouped by page and timestamped. Clicking a comment opens the review
// tool at the exact pin, on the device it was left on.

interface FeedbackData {
  link: string;
  token: string;
  slack: boolean;
  notify: {
    slackChannel: string;
    defaultChannel: boolean;
    botToken: boolean;
    emailClients: boolean;
    gmail: string | null;
    digestTo: string | null;
  };
  comments: Feedback[];
}

const DEVICE_ICON: Record<Device, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };
const DEVICE_LABEL: Record<Device, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };
const STATUS_STYLE: Record<FeedbackStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-[#0CA4C3]/12 text-[#01384C]" },
  in_progress: { label: "In progress", cls: "bg-amber-50 text-amber-700" },
  resolved: { label: "Resolved", cls: "bg-emerald-50 text-emerald-700" },
};
const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";

const toDate = (iso: string) => new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
function stamp(iso: string) {
  return toDate(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function ago(iso: string) {
  const mins = Math.round((Date.now() - toDate(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function Photo({ name, team, src, size = 20 }: { name: string; team: boolean; src: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (src || team) return <img src={src || "/mmg-icon.png"} alt="" className="shrink-0 rounded-full object-cover bg-[#001A2E]" style={{ width: size, height: size }} />;
  const letters = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return <span className="flex shrink-0 items-center justify-center rounded-full bg-[#0CA4C3]/15 font-semibold text-[#01384C]" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>{letters}</span>;
}

// Where this client's feedback is announced: their Slack channel, the team's
// email digest (from the connected Gmail) and emails back to commenters.
function NotifySettings({ clientSlug, clientName, notify, onSaved }: { clientSlug: string; clientName: string; notify: FeedbackData["notify"]; onSaved: () => void }) {
  const [channel, setChannel] = useState(notify.slackChannel);
  const [emailClients, setEmailClients] = useState(notify.emailClients);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);
  const dirty = channel.trim() !== notify.slackChannel || emailClients !== notify.emailClients;

  async function save() {
    setState("saving"); setErr(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: clientSlug, notify: { slackChannel: channel.trim(), emailClients } }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || "Couldn't save."); setState("idle"); return; }
    setState("saved");
    onSaved();
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <Card>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <div>
          <p className={eyebrow}>Slack channel</p>
          <input
            value={channel} onChange={(e) => setChannel(e.target.value)} placeholder={notify.defaultChannel ? "Default feedback channel" : "#client-name"}
            disabled={!notify.botToken}
            className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px] outline-none focus:border-[#0CA4C3]/50 disabled:bg-muted/40"
          />
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            {notify.botToken
              ? <>A channel name or ID for {clientName}&apos;s comments, replies and status changes. Invite the MMG Pulse bot to it first. Blank uses the default channel.</>
              : "Per-client channels need SLACK_BOT_TOKEN in Vercel."}
          </p>
        </div>
        <div>
          <p className={eyebrow}>Email</p>
          {notify.gmail ? (
            <>
              <p className="mt-2 flex items-start gap-2 text-[14px] text-[#001A2E]">
                <Mail size={15} className="mt-0.5 shrink-0 text-[#0394B2]" />
                <span>New comments are batched into one email to <span className="font-medium">{notify.digestTo}</span> a couple of minutes after {clientName} stops commenting.</span>
              </p>
              <label className="mt-3 flex items-start gap-2 text-[14px] text-[#001A2E] cursor-pointer">
                <input type="checkbox" checked={emailClients} onChange={(e) => setEmailClients(e.target.checked)} className="mt-1 accent-[#0CA4C3]" />
                <span>Email commenters when we reply or change a comment&apos;s status <span className="block text-[12.5px] text-muted-foreground">Sent from {notify.gmail}, to the email they gave with their comment.</span></span>
              </label>
            </>
          ) : (
            <p className="mt-2 text-[14px] text-muted-foreground">Connect Gmail on the Client Page tab to send feedback emails. Until then, only Slack is notified.</p>
          )}
        </div>
        <div className="md:col-span-2 flex items-center justify-end gap-3">
          {err && <span className="text-[13px] text-red-600">{err}</span>}
          <button onClick={save} disabled={!dirty || state === "saving"} className="inline-flex items-center gap-1.5 rounded-lg bg-[#001A2E] px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
            {state === "saving" ? <Loader2 size={13} className="animate-spin" /> : state === "saved" ? <Check size={13} /> : null} {state === "saved" ? "Saved" : "Save"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

interface ReviewPage { path: string; name: string; link: string }

// One review link per page, for sending a client straight to each page.
// They all use the same review link underneath, so everything still lands
// here. Unticked pages are left out of "Copy for email" (remembered per client).
function PageLinks({ clientSlug }: { clientSlug: string }) {
  const [pages, setPages] = useState<ReviewPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skipKey = `mmg-page-links-skip:${clientSlug}`;
  // Only rendered after a click, so localStorage is there to read.
  const [skipped, setSkipped] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(skipKey) || "[]"); } catch { return []; }
  });
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/feedback/pages?client=${clientSlug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => (json.pages ? setPages(json.pages) : setError(json.error || "Couldn't read the site's pages.")))
      .catch(() => setError("Couldn't read the site's pages."));
  }, [clientSlug]);

  function toggle(path: string) {
    const next = skipped.includes(path) ? skipped.filter((p) => p !== path) : [...skipped, path];
    setSkipped(next);
    try { localStorage.setItem(skipKey, JSON.stringify(next)); } catch { /* private mode */ }
  }
  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const chosen = (pages || []).filter((p) => !skipped.includes(p.path));
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className={eyebrow}>Page links</p>
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              Each link opens the review tool on that page. Comments from any of them land in this tab, Slack and the email digest like any other.
            </p>
          </div>
          {pages && (
            <button
              onClick={() => copy(chosen.map((p) => `${p.name}: ${p.link}`).join("\n"), "all")}
              disabled={chosen.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#0394B2] disabled:opacity-50"
            >
              {copied === "all" ? <Check size={14} /> : <Files size={14} />} {copied === "all" ? "Copied" : `Copy ${chosen.length} for email`}
            </button>
          )}
        </div>
        {error ? <p className="text-[14px] text-red-600">{error}</p> : !pages ? (
          <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Reading the site&apos;s pages…</p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto rounded-xl border border-border divide-y divide-border/60">
            {pages.map((p) => {
              const on = !skipped.includes(p.path);
              return (
                <div key={p.path} className={`flex items-center gap-3 px-3 py-2 text-[14px] ${on ? "" : "opacity-50"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.path)} title={on ? "Leave out of Copy for email" : "Include in Copy for email"} className="accent-[#0CA4C3]" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[#001A2E] truncate">{p.name}</p>
                    <p className="text-[12px] text-muted-foreground truncate">{p.path}</p>
                  </div>
                  <a href={p.link} target="_blank" rel="noreferrer" title="Open" className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/50"><ExternalLink size={14} /></a>
                  <button onClick={() => copy(p.link, p.path)} title="Copy link" className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/50">
                    {copied === p.path ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <p className={eyebrow}>{label}</p>
      <p className="mt-2 font-headline text-[30px] leading-none" style={{ color: tone || "#001A2E" }}>{value}</p>
    </div>
  );
}

export function ClientFeedback({ clientSlug, clientName }: { clientSlug: string; clientName: string }) {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [status, setStatus] = useState<"active" | FeedbackStatus | "all">("active");
  const [pageFilter, setPageFilter] = useState("all");
  const [device, setDevice] = useState<"all" | Device>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showNotify, setShowNotify] = useState(false);
  const [showPages, setShowPages] = useState(false);

  function load() {
    return fetch(`/api/feedback?client=${clientSlug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: FeedbackData) => { if (json.link) setData(json); })
      .catch(() => {});
  }
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => clearInterval(t);
  }, [clientSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function changeStatus(c: Feedback, next: FeedbackStatus) {
    if (!data) return;
    setBusy(`${c.id}`);
    await fetch(`/api/review/${data.token}/${c.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", status: next, authorName: "MMG Studio" }),
    });
    await load();
    setBusy(null);
  }

  async function newLink() {
    if (!confirm("Create a new review link? The current link stops working right away.")) return;
    setBusy("link");
    await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: clientSlug, rotate: true }) });
    await load();
    setBusy(null);
  }

  const comments = useMemo(() => (data?.comments || []).filter((c) => c.kind === "comment"), [data]);
  const approvals = useMemo(() => (data?.comments || []).filter((c) => c.kind === "approval"), [data]);
  const pages = useMemo(() => [...new Set(comments.map((c) => c.pagePath))].sort(), [comments]);
  const counts = {
    open: comments.filter((c) => c.status === "open").length,
    in_progress: comments.filter((c) => c.status === "in_progress").length,
    resolved: comments.filter((c) => c.status === "resolved").length,
  };

  const filtered = comments.filter((c) =>
    (status === "all" || (status === "active" ? c.status !== "resolved" : c.status === status)) &&
    (pageFilter === "all" || c.pagePath === pageFilter) &&
    (device === "all" || c.device === device) &&
    (!query.trim() || `${c.body} ${c.authorName} ${c.replies.map((r) => r.body).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
  );
  // Pages with the most recent activity first; newest comment first inside each.
  const groups = [...filtered.reduce((m, c) => m.set(c.pagePath, [...(m.get(c.pagePath) || []), c]), new Map<string, Feedback[]>())]
    .map(([path, items]) => ({ path, items: items.sort((a, b) => b.id - a.id), title: items.find((i) => i.pageTitle)?.pageTitle || null }))
    .sort((a, b) => b.items[0].id - a.items[0].id);
  const lastComment = comments.length ? comments.reduce((a, b) => (a.id > b.id ? a : b)) : null;
  const openAt = (c: Feedback) => (data ? `${data.link}?c=${c.id}` : "#");
  const photoSrc = (ref: string | null) => (ref && data ? photoPath(data.token, ref) : null);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0394B2] mb-1.5">Client feedback</div>
          <h2 className="font-headline text-[28px] text-[#001A2E]">What {clientName} has flagged</h2>
          <p className="mt-1 max-w-[720px] text-[15px] text-muted-foreground">
            Comments {clientName} leaves on their live site through the review link. Open ones also appear in the Agents tab, where an agent can draft the fix.
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(data.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3.5 py-2 text-[14px] font-semibold text-white hover:bg-[#0394B2]"
            >
              {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Copied" : "Copy client link"}
            </button>
            <a href={data.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-[14px] font-medium hover:bg-muted/50">
              Open review <ExternalLink size={13} />
            </a>
            <button onClick={newLink} disabled={busy === "link"} title="Replace the link (the old one stops working)" className="p-2 rounded-lg text-muted-foreground hover:bg-white">
              <RefreshCw size={15} className={busy === "link" ? "animate-spin" : ""} />
            </button>
          </div>
        )}
      </div>

      {!data ? (
        <Card><CardContent className="py-14 flex items-center justify-center gap-2 text-[15px] text-muted-foreground"><Loader2 size={17} className="animate-spin" /> Loading feedback…</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
            <Stat label="Open" value={counts.open} tone="#0394B2" />
            <Stat label="In progress" value={counts.in_progress} tone="#B45309" />
            <Stat label="Resolved" value={counts.resolved} tone="#047857" />
            <Stat label="Pages approved" value={approvals.length} />
            <Stat label="Last comment" value={lastComment ? ago(lastComment.createdAt) : "None"} />
          </div>

          <div className="flex flex-wrap items-center gap-2 px-1 text-[13px]">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${data.slack ? "border-border bg-white text-[#001A2E]" : "border-dashed border-border text-muted-foreground"}`}>
              {data.slack ? <Check size={12} className="text-emerald-600" /> : <MessageSquare size={12} />} {data.slack ? `Posting to Slack${data.notify.slackChannel ? ` · ${data.notify.slackChannel}` : ""}` : "Slack not connected"}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${data.notify.gmail ? "border-border bg-white text-[#001A2E]" : "border-dashed border-border text-muted-foreground"}`}>
              {data.notify.gmail ? <Check size={12} className="text-emerald-600" /> : <Mail size={12} />} {data.notify.gmail ? `Emails on${data.notify.emailClients ? "" : " (team only)"}` : "Emails off"}
            </span>
            <button onClick={() => setShowNotify((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${showNotify ? "bg-[#001A2E] text-white" : "text-[#0394B2] hover:bg-white"}`}>
              <Bell size={12} /> Notifications
            </button>
            <button onClick={() => setShowPages((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${showPages ? "bg-[#001A2E] text-white" : "text-[#0394B2] hover:bg-white"}`}>
              <Files size={12} /> Page links
            </button>
            <code className="truncate max-w-[480px] rounded-full bg-white border border-border px-2.5 py-1 text-[12px] text-muted-foreground">{data.link}</code>
          </div>

          {showPages && <PageLinks clientSlug={clientSlug} />}
          {showNotify && <NotifySettings key={`${data.notify.slackChannel}:${data.notify.emailClients}`} clientSlug={clientSlug} clientName={clientName} notify={data.notify} onSaved={load} />}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-[#001A2E]/[0.06] p-0.5">
              {([["active", `Open (${counts.open + counts.in_progress})`], ["in_progress", "In progress"], ["resolved", "Resolved"], ["all", "All"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setStatus(key)} className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${status === key ? "bg-white shadow-sm text-[#001A2E]" : "text-muted-foreground hover:text-[#001A2E]"}`}>{label}</button>
              ))}
            </div>
            <select value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-[13px]">
              <option value="all">All pages ({pages.length})</option>
              {pages.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={device} onChange={(e) => setDevice(e.target.value as typeof device)} className="rounded-lg border border-border bg-white px-3 py-2 text-[13px]">
              <option value="all">All devices</option>
              <option value="desktop">Desktop</option>
              <option value="tablet">Tablet</option>
              <option value="mobile">Mobile</option>
            </select>
            <label className="relative ml-auto">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search comments" className="w-[220px] rounded-lg border border-border bg-white py-2 pl-8 pr-3 text-[13px] outline-none focus:border-[#0CA4C3]/50" />
            </label>
          </div>

          {groups.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-[15px] text-muted-foreground">
              {comments.length === 0
                ? <>No feedback yet. Send {clientName} the client link: they can click anywhere on their site to leave a comment.</>
                : "No comments match these filters."}
            </CardContent></Card>
          ) : groups.map((g) => (
            <Card key={g.path}>
              <CardContent className="space-y-1">
                <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-border/70">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-[#0CA4C3]/10"><FileText size={16} className="text-[#0394B2]" /></span>
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold text-[#001A2E] truncate">{g.path === "/" ? "Home" : g.path}</p>
                    {g.title && <p className="text-[13px] text-muted-foreground truncate">{g.title}</p>}
                  </div>
                  <span className="ml-auto text-[13px] text-muted-foreground">{g.items.length} {g.items.length === 1 ? "comment" : "comments"}</span>
                  {approvals.some((a) => a.pagePath === g.path) && (
                    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700"><CheckCircle2 size={14} /> Approved</span>
                  )}
                </div>
                {g.items.map((c) => {
                  const DIcon = DEVICE_ICON[c.device];
                  const isOpen = expanded === c.id;
                  return (
                    <div key={c.id} className="py-3.5 border-b border-border/50 last:border-0">
                      <div className="flex items-start gap-3">
                        <a href={openAt(c)} target="_blank" rel="noreferrer" title="Open at the pin" className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white ${c.status === "resolved" ? "bg-slate-400" : "bg-[#0CA4C3]"} hover:ring-4 hover:ring-[#0CA4C3]/20`}>
                          {c.number}
                        </a>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
                            <Photo name={c.authorName} team={c.isTeam} src={photoSrc(c.authorPhoto)} />
                            <span className="font-semibold text-[#001A2E]">{c.authorName}</span>
                            {c.isTeam && <span className="rounded bg-[#001A2E] px-1.5 py-0.5 text-[10px] font-semibold text-white">MMG</span>}
                            <time dateTime={toDate(c.createdAt).toISOString()} className="text-muted-foreground">{stamp(c.createdAt)}</time>
                            <span className="inline-flex items-center gap-1 text-muted-foreground"><DIcon size={12} /> {DEVICE_LABEL[c.device]}{c.viewportWidth ? ` · ${c.viewportWidth}px` : ""}</span>
                            {c.browser && <span className="text-muted-foreground">{c.browser}</span>}
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[c.status].cls}`}>{STATUS_STYLE[c.status].label}</span>
                          </div>
                          <a href={openAt(c)} target="_blank" rel="noreferrer" className="mt-1 block text-[14.5px] leading-relaxed text-[#001A2E]/90 whitespace-pre-line hover:text-[#0394B2]">{c.body}</a>
                          {c.anchor?.text && <p className="mt-1 text-[12px] text-muted-foreground truncate">Pinned on “{c.anchor.text}”</p>}
                          {c.replies.length > 0 && (
                            <button onClick={() => setExpanded(isOpen ? null : c.id)} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#0394B2]">
                              {c.replies.length} {c.replies.length === 1 ? "reply" : "replies"} <ChevronDown size={13} className={isOpen ? "rotate-180" : ""} />
                            </button>
                          )}
                          {isOpen && (
                            <div className="mt-2 space-y-2 border-l-2 border-[#0CA4C3]/25 pl-3">
                              {c.replies.map((r) => (
                                <div key={r.id} className="text-[13.5px]">
                                  <span className="inline-block align-middle mr-1.5"><Photo name={r.authorName} team={r.isTeam} src={photoSrc(r.authorPhoto)} size={18} /></span>
                                  <span className="font-semibold text-[#001A2E]">{r.authorName}</span>{" "}
                                  {r.isTeam && <span className="rounded bg-[#001A2E] px-1 py-0.5 text-[9px] font-semibold text-white align-middle">MMG</span>}{" "}
                                  <span className="text-muted-foreground">{stamp(r.createdAt)}</span>
                                  <p className="text-[#001A2E]/85 whitespace-pre-line">{r.body}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <a href={openAt(c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium hover:bg-muted/50">
                            Review <ExternalLink size={12} />
                          </a>
                          {c.status === "resolved" ? (
                            <button onClick={() => changeStatus(c, "open")} disabled={busy === `${c.id}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted/50"><RotateCcw size={12} /> Reopen</button>
                          ) : (
                            <>
                              {c.status === "open" && (
                                <button onClick={() => changeStatus(c, "in_progress")} disabled={busy === `${c.id}`} title="Mark in progress" className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/50"><Wrench size={14} /></button>
                              )}
                              <button onClick={() => changeStatus(c, "resolved")} disabled={busy === `${c.id}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50"><Check size={12} /> Resolve</button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}

          {approvals.length > 0 && (
            <Card>
              <CardContent>
                <p className="font-headline text-[22px] text-[#001A2E] mb-3">Approved pages</p>
                <div className="divide-y divide-border/60">
                  {approvals.sort((a, b) => b.id - a.id).map((a) => (
                    <div key={a.id} className="flex items-center gap-3 py-2.5 text-[14px]">
                      <CheckCircle2 size={16} className="text-emerald-600" />
                      <span className="font-medium text-[#001A2E]">{a.pagePath === "/" ? "Home" : a.pagePath}</span>
                      <span className="text-muted-foreground">by {a.authorName} · {stamp(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
