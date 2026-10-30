"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  BarChart3, Check, CheckCircle2, ChevronLeft, Hand, Link2, Loader2, MessageCircle, Monitor, PanelLeftClose,
  PanelLeftOpen, RefreshCw, RotateCcw, Send, Smartphone, Tablet, X,
} from "lucide-react";
import type { Anchor, Device, Feedback } from "@/lib/feedback";

interface ReviewData {
  client: { name: string; domain: string; iconUrl: string | null; slug: string };
  isTeam: boolean;
  comments: Feedback[];
  progressPath: string | null;
}
type Rect = { x: number; y: number; bottom: number };

const DEVICES: { key: Device; label: string; width: number | null; Icon: typeof Monitor }[] = [
  { key: "desktop", label: "Desktop", width: null, Icon: Monitor },
  { key: "tablet", label: "Tablet", width: 820, Icon: Tablet },
  { key: "mobile", label: "Mobile", width: 390, Icon: Smartphone },
];
const DEVICE_ICON: Record<Device, typeof Monitor> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };
const ME_KEY = "mmg-review-me";

function when(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 1 && new Date().getDate() === d.getDate()) return time;
  if (days < 6) return `${d.toLocaleDateString([], { weekday: "long" })} ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
const samePath = (a: string, b: string) => (a.replace(/\/+$/, "") || "/") === (b.replace(/\/+$/, "") || "/");
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function Avatar({ name, team }: { name: string; team?: boolean }) {
  return (
    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${team ? "bg-[#001A2E] text-white" : "bg-[#0CA4C3]/15 text-[#01384C]"}`}>
      {initials(name) || "?"}
    </span>
  );
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function ReviewRoute() {
  return (
    <Suspense fallback={<div className="h-screen grid place-items-center bg-[#EEF2F4]"><Loader2 size={22} className="animate-spin text-[#0CA4C3]" /></div>}>
      <ReviewPage />
    </Suspense>
  );
}

function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const search = useSearchParams();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"comment" | "browse">("comment");
  const [device, setDevice] = useState<Device>("desktop");
  const [src, setSrc] = useState<string | null>(null);
  const [page, setPage] = useState<{ url: string; path: string; title: string } | null>(null);
  const [frameLoading, setFrameLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ anchor: Anchor; viewportWidth: number } | null>(null);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  // Frame position inside the stage, measured when pins report in (not during render).
  const [box, setBox] = useState<{ left: number; top: number; height: number; stageW: number; stageH: number } | null>(null);
  const [scope, setScope] = useState<"page" | "all">("page");
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [panelOpen, setPanelOpen] = useState(true);
  const [me, setMe] = useState<{ name: string; email: string }>({ name: "", email: "" });
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);

  const proxyUrl = useCallback((url: string) => {
    const u = new URL(url);
    return `/proxy/${token}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  }, [token]);

  const load = useCallback(() => {
    return fetch(`/api/review/${token}`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "Couldn't open this review.");
        setData(json);
        return json as ReviewData;
      })
      .catch((err) => { setError(err.message); return null; });
  }, [token]);

  // First load: open the linked comment (?c=), else the homepage.
  useEffect(() => {
    load().then((d) => {
      if (!d) return;
      let saved: { name: string; email: string } | null = null;
      try { saved = JSON.parse(localStorage.getItem(ME_KEY) || "null"); } catch { /* private mode */ }
      if (saved?.name) setMe(saved);
      else if (d.isTeam) setMe({ name: "MMG Studio", email: "" });
      const linked = d.comments.find((c) => c.id === Number(search.get("c")));
      if (linked) {
        setDevice(linked.device);
        setActiveId(linked.id);
        pendingFocus.current = linked.id;
        setSrc(proxyUrl(linked.pageUrl));
        setScope("page");
        setFilter(linked.status === "resolved" ? "resolved" : "open");
      } else {
        setSrc(`/proxy/${token}`);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live updates from other reviewers and the MMG team.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 8000);
    return () => clearInterval(t);
  }, [load]);

  const post = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const comments = useMemo(() => (data?.comments || []).filter((c) => c.kind === "comment"), [data]);
  const pagePins = useMemo(
    () => comments.filter((c) => page && samePath(c.pagePath, page.path) && c.device === device && c.anchor),
    [comments, page, device]
  );

  // Keep the pins inside the page in sync.
  useEffect(() => {
    post({ type: "pins", pins: pagePins.map((c) => ({ id: c.id, number: c.number, anchor: c.anchor, status: c.status, active: c.id === activeId })) });
  }, [pagePins, activeId, post]);
  useEffect(() => { post({ type: "mode", mode }); }, [mode, post]);

  // Messages from the review layer inside the page.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== frameRef.current?.contentWindow) return;
      const m = e.data || {};
      if (m.source !== "mmg-review") return;
      if (m.type === "ready") {
        setPage({ url: m.pageUrl, path: m.path, title: m.title });
        setFrameLoading(false);
        post({ type: "mode", mode });
        if (pendingFocus.current) {
          const id = pendingFocus.current;
          pendingFocus.current = null;
          setTimeout(() => post({ type: "focus", id }), 900);
        }
      } else if (m.type === "navigate") {
        setDraft(null);
        setActiveId(null);
        setFrameLoading(true);
        setSrc(proxyUrl(m.url));
      } else if (m.type === "draft") {
        setDraft({ anchor: m.anchor, viewportWidth: m.viewportWidth });
        setActiveId(null);
      } else if (m.type === "pinClick") {
        setDraft(null);
        post({ type: "clearDraft" });
        setActiveId((cur) => (cur === m.id ? null : m.id));
      } else if (m.type === "pinRects") {
        setRects(m.rects || {});
        const frame = frameRef.current, stage = stageRef.current;
        if (frame && stage) {
          const fr = frame.getBoundingClientRect(), sr = stage.getBoundingClientRect();
          setBox({ left: fr.left - sr.left, top: fr.top - sr.top, height: fr.height, stageW: sr.width, stageH: sr.height });
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mode, post, proxyUrl]);

  function openComment(c: Feedback) {
    setDraft(null);
    post({ type: "clearDraft" });
    setActiveId(c.id);
    const otherPage = !page || !samePath(c.pagePath, page.path);
    if (c.device !== device || otherPage) {
      // The frame reloads (new size or page); focus once it reports ready.
      pendingFocus.current = c.id;
      setFrameLoading(true);
      if (c.device !== device) setDevice(c.device);
      if (otherPage) setSrc(proxyUrl(c.pageUrl));
    } else {
      post({ type: "focus", id: c.id });
    }
  }

  function saveMe(next: { name: string; email: string }) {
    setMe(next);
    try { localStorage.setItem(ME_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }

  async function submitComment(body: string, who: { name: string; email: string }) {
    if (!draft || !page) return;
    saveMe(who);
    const res = await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body, authorName: who.name, authorEmail: who.email, anchor: draft.anchor, viewportWidth: draft.viewportWidth,
        device, pageUrl: page.url, pageTitle: page.title,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Couldn't post that comment.");
    setDraft(null);
    post({ type: "clearDraft" });
    const fresh = await load();
    if (fresh && json.comment) setActiveId(json.comment.id);
  }

  async function act(id: number, payload: Record<string, unknown>) {
    const res = await fetch(`/api/review/${token}/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorName: me.name, authorEmail: me.email, ...payload }),
    });
    if (res.ok) await load();
    return res.ok;
  }

  async function approvePage() {
    if (!page) return;
    const name = me.name || window.prompt("Your name, so MMG knows who approved this page:")?.trim();
    if (!name) return;
    saveMe({ name, email: me.email });
    await fetch(`/api/review/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "approval", body: "", authorName: name, authorEmail: me.email, device, pageUrl: page.url, pageTitle: page.title }),
    });
    load();
  }

  const listed = comments
    .filter((c) => scope === "all" || (page && samePath(c.pagePath, page.path)))
    .filter((c) => filter === "all" || (filter === "resolved" ? c.status === "resolved" : c.status !== "resolved"))
    .sort((a, b) => b.id - a.id);
  const approved = page && (data?.comments || []).some((c) => c.kind === "approval" && samePath(c.pagePath, page.path));
  const active = comments.find((c) => c.id === activeId) || null;
  const deviceWidth = DEVICES.find((d) => d.key === device)?.width;

  // Popover placement next to the pin, inside the stage.
  function popoverStyle(rect?: Rect): React.CSSProperties | null {
    if (!rect || !box) return null;
    if (rect.bottom < 0 || rect.y > box.height) return null;
    const width = Math.min(380, box.stageW - 24);
    const left = Math.min(Math.max(12, box.left + rect.x - 24), box.stageW - width - 12);
    const top = Math.min(box.top + rect.bottom + 10, box.stageH - 120);
    return { left, top, width };
  }

  if (error) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#F6F8F9] px-6 text-center">
        <div><p className="font-headline text-[28px] text-[#001A2E]">Review link unavailable</p><p className="mt-2 text-[15px] text-muted-foreground">{error}</p></div>
      </main>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#EEF2F4] text-[#001A2E] overflow-hidden">
      {/* Top bar */}
      <header className="h-14 shrink-0 bg-white border-b border-border flex items-center px-3 gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {data?.isTeam && (
            <a href={`/${data.client.slug}`} className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/60" title="Back to dashboard"><ChevronLeft size={18} /></a>
          )}
          {data?.client.iconUrl ? (
            <span className="relative size-7 overflow-hidden rounded-md shrink-0">
              <Image src={data.client.iconUrl} alt="" fill sizes="28px" unoptimized className="object-cover" />
            </span>
          ) : <Image src="/mmg-icon.png" alt="MMG" width={28} height={28} className="rounded-md" />}
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight truncate">{data?.client.name || "Loading…"}</p>
            <p className="text-[12px] text-muted-foreground truncate">{page ? page.path : data?.client.domain}</p>
          </div>
          <button onClick={() => { if (frameRef.current && src) { setFrameLoading(true); frameRef.current.src = src; } }} className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/60" title="Reload page">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-[#001A2E]/[0.06] p-0.5">
            {([["comment", "Comment", MessageCircle], ["browse", "Browse", Hand]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => { setMode(key); if (key === "browse") { setDraft(null); post({ type: "clearDraft" }); } }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${mode === key ? "bg-white shadow-sm text-[#001A2E]" : "text-muted-foreground hover:text-[#001A2E]"}`}
              >
                <Icon size={14} className={mode === key ? "text-[#0CA4C3]" : ""} /> {label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-border p-0.5">
            {DEVICES.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => { setDevice(key); setActiveId(null); setDraft(null); }} title={label}
                className={`rounded-md p-1.5 transition-colors ${device === key ? "bg-[#0CA4C3]/12 text-[#0394B2]" : "text-muted-foreground hover:text-[#001A2E]"}`}>
                <Icon size={15} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 flex-1">
          {data?.progressPath && (
            <a href={data.progressPath} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted/50" title="See how your website is doing">
              <BarChart3 size={14} className="text-[#0CA4C3]" /> <span className="hidden lg:inline">View your website data</span><span className="lg:hidden">Your data</span>
            </a>
          )}
          {approved ? (
            <span className="hidden md:inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700"><CheckCircle2 size={15} /> Page approved</span>
          ) : (
            <button onClick={approvePage} disabled={!page} className="hidden md:inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted/50 disabled:opacity-50">
              <Check size={14} /> Approve page
            </button>
          )}
          <button
            onClick={() => { navigator.clipboard.writeText(window.location.origin + window.location.pathname); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#0394B2]"
          >
            {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Copied" : "Share"}
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Comments panel */}
        {panelOpen ? (
          <aside className="w-[360px] shrink-0 bg-white border-r border-border flex flex-col min-h-0">
            <div className="flex items-center gap-1 px-3 h-12 border-b border-border">
              {([["page", "This page"], ["all", "All pages"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setScope(key)} className={`rounded-md px-2.5 py-1 text-[13px] font-medium ${scope === key ? "bg-[#001A2E]/[0.06] text-[#001A2E]" : "text-muted-foreground hover:text-[#001A2E]"}`}>{label}</button>
              ))}
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="ml-auto rounded-md border border-border bg-white px-2 py-1 text-[12px] text-muted-foreground">
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="all">All</option>
              </select>
              <button onClick={() => setPanelOpen(false)} className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/60" title="Hide comments"><PanelLeftClose size={15} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {listed.length === 0 ? (
                <div className="px-6 py-14 text-center text-[14px] text-muted-foreground">
                  <MessageCircle size={22} className="mx-auto mb-3 text-[#0CA4C3]" />
                  {mode === "comment" ? "Click anywhere on the page to leave a comment." : "Switch to Comment to leave feedback on this page."}
                </div>
              ) : listed.map((c) => {
                const DIcon = DEVICE_ICON[c.device];
                return (
                  <button key={c.id} onClick={() => openComment(c)} className={`w-full text-left px-4 py-3.5 border-b border-border/70 hover:bg-[#0CA4C3]/[0.04] ${activeId === c.id ? "bg-[#0CA4C3]/[0.07]" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ${c.status === "resolved" ? "bg-slate-400" : "bg-[#0CA4C3]"}`}>{c.number}</span>
                      <span className="text-[13px] font-semibold truncate">{c.authorName}</span>
                      {c.isTeam && <span className="rounded bg-[#001A2E] px-1.5 py-0.5 text-[10px] font-semibold text-white">MMG</span>}
                      <span className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground"><DIcon size={12} /> {when(c.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#001A2E]/85 line-clamp-4 whitespace-pre-line">{c.body}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-[12px]">
                      {scope === "all" && <span className="text-muted-foreground truncate">{c.pagePath}</span>}
                      {c.replies.length > 0 && <span className="text-[#0394B2] font-medium">{c.replies.length} {c.replies.length === 1 ? "reply" : "replies"}</span>}
                      {c.status === "in_progress" && <span className="text-amber-700 font-medium">In progress</span>}
                      {c.status === "resolved" && <span className="text-emerald-700 font-medium">Resolved</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-border text-[12px] text-muted-foreground flex items-center justify-between">
              <span>{me.name ? <>Commenting as <span className="font-medium text-[#001A2E]">{me.name}</span></> : "Feedback goes straight to MMG Studio"}</span>
              {me.name && <button onClick={() => saveMe({ name: "", email: "" })} className="underline hover:text-[#001A2E]">Change</button>}
            </div>
          </aside>
        ) : (
          <button onClick={() => setPanelOpen(true)} className="w-11 shrink-0 bg-white border-r border-border flex flex-col items-center pt-3 gap-2 text-muted-foreground hover:text-[#001A2E]" title="Show comments">
            <PanelLeftOpen size={16} />
            <span className="text-[11px] font-semibold">{comments.filter((c) => c.status !== "resolved").length}</span>
          </button>
        )}

        {/* Site */}
        <div ref={stageRef} className="relative flex-1 min-w-0 flex justify-center overflow-hidden p-0">
          <div
            className={`relative h-full bg-white transition-[width] duration-300 ${deviceWidth ? "my-4 rounded-[18px] border border-border shadow-[0_8px_40px_rgba(0,26,46,0.12)] overflow-hidden" : ""}`}
            style={{ width: deviceWidth ? deviceWidth : "100%", height: deviceWidth ? "calc(100% - 32px)" : "100%" }}
          >
            {src && (
              <iframe
                ref={frameRef}
                key={`${device}:${src}`}
                src={src}
                title="Client website"
                // Isolation comes from the proxy's CSP sandbox header (the page gets an
                // opaque origin); an iframe sandbox attribute is blocked by some
                // embedded browsers and adds nothing on top.
                className="absolute inset-0 w-full h-full border-0"
                onLoad={() => setFrameLoading(false)}
              />
            )}
            {frameLoading && (
              <div className="absolute inset-0 grid place-items-center bg-white/70">
                <Loader2 size={22} className="animate-spin text-[#0CA4C3]" />
              </div>
            )}
          </div>

          {/* Thread popover */}
          {active && (() => {
            const style = popoverStyle(rects[String(active.id)]);
            return style ? <Thread key={active.id} c={active} style={style} me={me} isTeam={!!data?.isTeam} onClose={() => setActiveId(null)} act={act} saveMe={saveMe} /> : null;
          })()}
          {draft && (() => {
            const style = popoverStyle(rects.draft);
            return style ? (
              <Composer style={style} me={me} onCancel={() => { setDraft(null); post({ type: "clearDraft" }); }} onSubmit={submitComment} />
            ) : null;
          })()}
        </div>
      </div>
    </div>
  );
}

function NameFields({ who, setWho }: { who: { name: string; email: string }; setWho: (w: { name: string; email: string }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-2">
      <input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="Your name" className="rounded-lg border border-border px-2.5 py-1.5 text-[13px] outline-none focus:border-[#0CA4C3]/50" />
      <input value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} placeholder="Email (optional)" type="email" className="rounded-lg border border-border px-2.5 py-1.5 text-[13px] outline-none focus:border-[#0CA4C3]/50" />
    </div>
  );
}

function Composer({ style, me, onCancel, onSubmit }: {
  style: React.CSSProperties; me: { name: string; email: string };
  onCancel: () => void; onSubmit: (body: string, who: { name: string; email: string }) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [who, setWho] = useState(me);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!body.trim() || !who.name.trim()) return;
    setBusy(true); setErr(null);
    try { await onSubmit(body.trim(), { name: who.name.trim(), email: who.email.trim() }); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="absolute z-20 rounded-xl border border-border bg-white p-3 shadow-[0_12px_40px_rgba(0,26,46,0.18)]" style={style}>
      {!me.name && <NameFields who={who} setWho={setWho} />}
      <textarea
        autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="Leave a comment…" rows={3}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); if (e.key === "Escape") onCancel(); }}
        className="w-full resize-none rounded-lg border border-border px-3 py-2 text-[14px] outline-none focus:border-[#0CA4C3]/50"
      />
      {err && <p className="mt-1 text-[12px] text-red-600">{err}</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted/60">Cancel</button>
        <button onClick={submit} disabled={busy || !body.trim() || !who.name.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#0394B2] disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Comment
        </button>
      </div>
    </div>
  );
}

function Thread({ c, style, me, isTeam, onClose, act, saveMe }: {
  c: Feedback; style: React.CSSProperties; me: { name: string; email: string }; isTeam: boolean;
  onClose: () => void; act: (id: number, payload: Record<string, unknown>) => Promise<boolean>; saveMe: (w: { name: string; email: string }) => void;
}) {
  const [body, setBody] = useState("");
  const [who, setWho] = useState(me);
  const [busy, setBusy] = useState(false);
  const DIcon = DEVICE_ICON[c.device];
  async function reply() {
    if (!body.trim() || !who.name.trim()) return;
    setBusy(true);
    saveMe(who);
    if (await act(c.id, { action: "reply", body: body.trim(), authorName: who.name.trim(), authorEmail: who.email })) setBody("");
    setBusy(false);
  }
  return (
    <div className="absolute z-20 rounded-xl border border-border bg-white shadow-[0_12px_40px_rgba(0,26,46,0.18)] flex flex-col max-h-[60vh]" style={style}>
      <div className="flex items-center gap-2 px-3 pt-3">
        <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ${c.status === "resolved" ? "bg-slate-400" : "bg-[#0CA4C3]"}`}>{c.number}</span>
        <span className="text-[12px] text-muted-foreground flex items-center gap-1 min-w-0 truncate" title={c.browser || ""}><DIcon size={12} className="shrink-0" /> {c.viewportWidth ? `${c.viewportWidth}px` : c.device}</span>
        <div className="ml-auto flex items-center gap-1">
          {c.status === "resolved" ? (
            <button onClick={() => act(c.id, { action: "status", status: "open" })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/60"><RotateCcw size={12} /> Reopen</button>
          ) : (
            <>
              {isTeam && c.status !== "in_progress" && (
                <button onClick={() => act(c.id, { action: "status", status: "in_progress" })} className="whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted/60">In progress</button>
              )}
              <button onClick={() => act(c.id, { action: "status", status: "resolved" })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50"><Check size={12} /> Resolve</button>
            </>
          )}
          <button onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:bg-muted/60"><X size={14} /></button>
        </div>
      </div>
      <div className="overflow-y-auto px-3 py-2 space-y-3">
        {[{ id: 0, authorName: c.authorName, isTeam: c.isTeam, body: c.body, createdAt: c.createdAt }, ...c.replies].map((r) => (
          <div key={r.id} className="flex gap-2.5">
            <Avatar name={r.authorName} team={r.isTeam} />
            <div className="min-w-0">
              <p className="text-[13px]"><span className="font-semibold">{r.authorName}</span> <span className="text-muted-foreground">{when(r.createdAt)}</span></p>
              <p className="text-[14px] leading-relaxed text-[#001A2E]/85 whitespace-pre-line break-words">{r.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2.5">
        {!me.name && <NameFields who={who} setWho={setWho} />}
        <div className="flex items-center gap-2">
          <input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") reply(); }} placeholder="Reply…" className="flex-1 rounded-lg border border-border px-3 py-1.5 text-[14px] outline-none focus:border-[#0CA4C3]/50" />
          <button onClick={reply} disabled={busy || !body.trim()} className="p-2 rounded-lg text-[#0394B2] hover:bg-[#0CA4C3]/10 disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button>
        </div>
      </div>
    </div>
  );
}
