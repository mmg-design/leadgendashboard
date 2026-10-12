"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ExternalLink, Link2, Loader2, MessageSquare, Monitor, RefreshCw, RotateCcw, Smartphone, Tablet, Wrench } from "lucide-react";
import type { Device, Feedback, FeedbackStatus } from "@/lib/feedback";

// The Agents tab's queue of feedback clients left through their review link.
// Each item opens the review tool at the exact pin, on the device it was left on.

interface QueueData {
  link: string;
  token: string;
  slack: boolean;
  comments: Feedback[];
}

const DEVICE_ICON: Record<Device, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };
const STATUS_ORDER: Record<FeedbackStatus, number> = { open: 0, in_progress: 1, resolved: 2 };

function when(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ClientUpdates({ clientSlug }: { clientSlug: string }) {
  const [data, setData] = useState<QueueData | null>(null);
  const [view, setView] = useState<"open" | "resolved">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    return fetch(`/api/feedback?client=${clientSlug}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: QueueData) => { if (json.link) setData(json); })
      .catch(() => {});
  }
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => clearInterval(t);
  }, [clientSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(c: Feedback, status: FeedbackStatus) {
    if (!data) return;
    setBusy(`${c.id}`);
    await fetch(`/api/review/${data.token}/${c.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", status, authorName: "MMG Studio" }),
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

  const comments = (data?.comments || []).filter((c) => c.kind === "comment");
  const open = comments.filter((c) => c.status !== "resolved");
  const shown = (view === "open" ? open : comments.filter((c) => c.status === "resolved"))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.id - a.id);
  const approvals = (data?.comments || []).filter((c) => c.kind === "approval");

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#E87BA4]/12"><MessageSquare size={18} className="text-[#C2457A]" /></span>
            <div>
              <p className="font-headline text-[24px] leading-tight text-[#001A2E]">Client Updates</p>
              <p className="text-[14px] text-muted-foreground">
                {open.length} open · {comments.length - open.length} resolved{approvals.length ? ` · ${approvals.length} page${approvals.length === 1 ? "" : "s"} approved` : ""}
                {data && !data.slack && " · Slack not connected yet"}
              </p>
            </div>
          </div>
          {data && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="hidden lg:block max-w-[320px] truncate rounded-lg bg-muted/60 px-2.5 py-1.5 text-[12px] text-muted-foreground">{data.link}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(data.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#0394B2]"
              >
                {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Copied" : "Copy client link"}
              </button>
              <a href={data.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium hover:bg-muted/50">
                Open review <ExternalLink size={13} />
              </a>
              <button onClick={newLink} disabled={busy === "link"} title="Replace the link (the old one stops working)" className="p-2 rounded-lg text-muted-foreground hover:bg-muted/50">
                <RefreshCw size={14} className={busy === "link" ? "animate-spin" : ""} />
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-1">
          {(["open", "resolved"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${view === v ? "bg-[#001A2E]/[0.06] text-[#001A2E]" : "text-muted-foreground hover:text-[#001A2E]"}`}>
              {v === "open" ? `Open (${open.length})` : `Resolved (${comments.length - open.length})`}
            </button>
          ))}
        </div>

        {!data ? (
          <div className="py-6 flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Loading feedback…</div>
        ) : shown.length === 0 ? (
          <p className="py-4 text-[14px] text-muted-foreground">
            {view === "open" ? "No open feedback. Send the client link to collect comments right on their site." : "Nothing resolved yet."}
          </p>
        ) : (
          <div className="divide-y divide-border/70 rounded-xl border border-border">
            {shown.map((c) => {
              const DIcon = DEVICE_ICON[c.device];
              return (
                <div key={c.id} className="flex items-start gap-3 px-4 py-3.5">
                  <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${c.status === "resolved" ? "bg-slate-400" : "bg-[#0CA4C3]"}`}>{c.number}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                      <span className="font-semibold text-[#001A2E]">{c.authorName}</span>
                      <span className="text-muted-foreground truncate">{c.pagePath}</span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><DIcon size={12} /> {c.viewportWidth ? `${c.viewportWidth}px` : c.device}</span>
                      <span className="text-muted-foreground">{when(c.createdAt)}</span>
                      {c.status === "in_progress" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">In progress</span>}
                    </div>
                    <p className="mt-1 text-[14px] leading-relaxed text-[#001A2E]/85 line-clamp-3 whitespace-pre-line">{c.body}</p>
                    {c.replies.length > 0 && (
                      <p className="mt-1 text-[12px] text-[#0394B2]">{c.replies.length} {c.replies.length === 1 ? "reply" : "replies"} · last from {c.replies[c.replies.length - 1].authorName}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <a href={`${data.link}?c=${c.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium hover:bg-muted/50">
                      Open <ExternalLink size={12} />
                    </a>
                    {c.status === "resolved" ? (
                      <button onClick={() => setStatus(c, "open")} disabled={busy === `${c.id}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted/50"><RotateCcw size={12} /> Reopen</button>
                    ) : (
                      <>
                        {c.status === "open" && (
                          <button onClick={() => setStatus(c, "in_progress")} disabled={busy === `${c.id}`} title="Mark in progress" className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/50"><Wrench size={14} /></button>
                        )}
                        <button onClick={() => setStatus(c, "resolved")} disabled={busy === `${c.id}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50"><Check size={12} /> Resolve</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
