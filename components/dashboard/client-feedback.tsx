"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Check, CheckCircle2, ChevronDown, ExternalLink, FileText, Link2, Loader2, MessageSquare, Monitor, RefreshCw, RotateCcw,
  Search, Smartphone, Tablet, Wrench,
} from "lucide-react";
import type { Device, Feedback, FeedbackStatus } from "@/lib/feedback";

// A client's own feedback page: everything they've left through their review
// link, grouped by page and timestamped. Clicking a comment opens the review
// tool at the exact pin, on the device it was left on.

interface FeedbackData {
  link: string;
  token: string;
  slack: boolean;
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
              {data.slack ? <Check size={12} className="text-emerald-600" /> : <MessageSquare size={12} />} {data.slack ? "Posting to Slack" : "Slack not connected"}
            </span>
            <code className="truncate max-w-[480px] rounded-full bg-white border border-border px-2.5 py-1 text-[12px] text-muted-foreground">{data.link}</code>
          </div>

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
