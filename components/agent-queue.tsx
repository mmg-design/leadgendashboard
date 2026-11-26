"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Check, ChevronDown, ExternalLink, FileSearch, Link2, Loader2, MessageSquare, RefreshCw, Search, Sparkles, UserCheck, UserPlus, Wrench, X } from "lucide-react";
import { Avatar, ClientLogo } from "@/components/avatar";
import { OutputView, type Post } from "@/components/dashboard/agents";
import type { StoredTask } from "@/lib/agent-tasks";
import type { AgentOutput } from "@/lib/agent-runner";

// Every client's agent recommendations in one scrollable queue. Filter by
// client, category, priority and status; sort by date or priority; then assign
// each one to a team member (with extra context) or have an agent draft the fix.
// Used full-page at /queue and in the Work page's slide-over.

type Category = "delegated" | "feedback" | "ai" | "links" | "indexing" | "search" | "upkeep";
type Impact = "high" | "medium" | "low";
interface Item {
  clientSlug: string; key: string; type: string; category: Category; impact: Impact; title: string; why: string;
  evidence: string[]; path: string | null; url: string | null; context: string; status: "open" | "drafted" | "applied" | "done" | "dismissed";
  draftSummary: string | null; createdAt: string; updatedAt: string;
  assigned: { taskId: number; assigneeId: number | null; workStatus: string } | null;
}
interface Person { id: number; name: string; title: string; photoVersion?: string | null }
interface Client { slug: string; name: string; logo: string | null }
interface Data { items: Item[]; clients: Client[]; people: Person[]; isOwner: boolean; me: number | null }

const CATEGORIES: Record<Category, { label: string; color: string; Icon: typeof Bot }> = {
  delegated: { label: "Delegated", color: "#1D475E", Icon: UserCheck },
  feedback: { label: "Client feedback", color: "#e87ba4", Icon: MessageSquare },
  ai: { label: "AI visibility", color: "#4a3aa7", Icon: Sparkles },
  links: { label: "Links", color: "#008300", Icon: Link2 },
  indexing: { label: "Indexing", color: "#eb6834", Icon: FileSearch },
  search: { label: "Search growth", color: "#2a78d6", Icon: Search },
  upkeep: { label: "Site upkeep", color: "#1baf7a", Icon: Wrench },
};
const IMPACT: Record<Impact, { label: string; cls: string; rank: number }> = {
  high: { label: "High impact", cls: "bg-[#001A2E] text-white", rank: 0 },
  medium: { label: "Medium", cls: "bg-slate-100 text-slate-700", rank: 1 },
  low: { label: "Low", cls: "bg-slate-50 text-slate-500", rank: 2 },
};
const SORTS = { newest: "Newest first", oldest: "Oldest first", priority: "Highest priority", client: "Client A–Z" } as const;
const STATUS_FILTERS = { all: "All open", open: "Needs action", drafted: "Draft ready", unassigned: "Unassigned", assigned: "Assigned" } as const;

const toDate = (iso: string) => new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - toDate(iso).getTime()) / 60000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : toDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const select = "rounded-lg border border-border bg-white px-3 py-2 text-[14px] min-w-0";
const AGENT = -1; // the "Agent" choice in the assign panel

export default function AgentQueue({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [client, setClient] = useState("");
  const [category, setCategory] = useState("");
  const [impact, setImpact] = useState("");
  const [status, setStatus] = useState<keyof typeof STATUS_FILTERS>("all");
  const [sort, setSort] = useState<keyof typeof SORTS>("newest");
  const [q, setQ] = useState("");

  const fetchData = useCallback(async () => {
    const r = await fetch("/api/agent-queue", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Couldn't load the queue.");
    return d as Data;
  }, []);
  useEffect(() => {
    let alive = true;
    fetchData().then((d) => { if (alive) { setData(d); setLoadedAt(Date.now()); } }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [fetchData]);
  async function refresh() {
    setRefreshing(true);
    try { setData(await fetchData()); setLoadedAt(Date.now()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't refresh."); }
    setRefreshing(false);
  }
  const patchItem = (key: string, slug: string, change: Partial<Item> | null) =>
    setData((d) => d && { ...d, items: change === null ? d.items.filter((i) => !(i.key === key && i.clientSlug === slug)) : d.items.map((i) => (i.key === key && i.clientSlug === slug ? { ...i, ...change } : i)) });

  const clients = useMemo(() => new Map(data?.clients.map((c) => [c.slug, c]) || []), [data]);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data?.items || []).filter((i) =>
      (!client || i.clientSlug === client) && (!category || i.category === category) && (!impact || i.impact === impact) &&
      (status === "all" || (status === "open" && i.status === "open" && !i.assigned?.assigneeId) || (status === "drafted" && i.status === "drafted") ||
        (status === "assigned" && !!i.assigned?.assigneeId) || (status === "unassigned" && !i.assigned?.assigneeId)) &&
      (!needle || `${i.title} ${i.why} ${clients.get(i.clientSlug)?.name || ""}`.toLowerCase().includes(needle)));
    const by = {
      newest: (a: Item, b: Item) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime(),
      oldest: (a: Item, b: Item) => toDate(a.createdAt).getTime() - toDate(b.createdAt).getTime(),
      priority: (a: Item, b: Item) => IMPACT[a.impact].rank - IMPACT[b.impact].rank || toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime(),
      client: (a: Item, b: Item) => (clients.get(a.clientSlug)?.name || "").localeCompare(clients.get(b.clientSlug)?.name || "") || IMPACT[a.impact].rank - IMPACT[b.impact].rank,
    }[sort];
    return [...list].sort(by);
  }, [data, client, category, impact, status, sort, q, clients]);

  const filtersOn = !!(client || category || impact || status !== "all" || q);

  return (
    <div className={compact ? "flex h-full flex-col" : "space-y-5"}>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "border-b border-[#1D475E]/[0.08] bg-white/80 px-4 py-3 backdrop-blur-md" : ""}`}>
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recommendations" aria-label="Search recommendations"
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-[14px] outline-none shadow-[0_1px_2px_rgba(7,61,143,0.06),0_3px_8px_rgba(7,61,143,0.05)] focus:border-[#0CA4C3]/50 focus:ring-2 focus:ring-[#0CA4C3]/15" />
        </div>
        <select className={select} value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
          <option value="">All clients</option>
          {data?.clients.filter((c) => data.items.some((i) => i.clientSlug === c.slug)).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <select className={select} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(Object.keys(CATEGORIES) as Category[]).map((c) => <option key={c} value={c}>{CATEGORIES[c].label}</option>)}
        </select>
        <select className={select} value={impact} onChange={(e) => setImpact(e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          <option value="high">High impact</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select className={select} value={status} onChange={(e) => setStatus(e.target.value as keyof typeof STATUS_FILTERS)} aria-label="Status">
          {Object.entries(STATUS_FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={select} value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)} aria-label="Sort">
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={refresh} disabled={refreshing} title="Reload the latest recommendations"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[14px] font-medium shadow-[0_1px_2px_rgba(7,61,143,0.06),0_3px_8px_rgba(7,61,143,0.05)] transition-all duration-200 hover:shadow-[0_1px_2px_rgba(7,61,143,0.08),0_6px_14px_rgba(7,61,143,0.08)] disabled:opacity-60">
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className={`flex items-center justify-between gap-3 text-[13px] text-muted-foreground ${compact ? "px-4 pt-3" : ""}`}>
        <span>{data ? `${items.length} of ${data.items.length} recommendations` : "Loading…"}{filtersOn && (
          <button onClick={() => { setClient(""); setCategory(""); setImpact(""); setStatus("all"); setQ(""); }} className="ml-2 font-medium text-[#0394B2] hover:underline">Clear filters</button>
        )}</span>
        {loadedAt && <span>Updated {ago(new Date(loadedAt).toISOString())}</span>}
      </div>

      {error && <p role="alert" className={`rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700 ${compact ? "mx-4" : ""}`}>{error}</p>}

      <div className={compact ? "flex-1 space-y-3 overflow-y-auto px-4 py-3" : "space-y-3"}>
        {!data ? <Loader2 className="animate-spin text-muted-foreground" /> : items.length === 0 ? (
          <div className="rounded-2xl card-depth px-5 py-10 text-center text-[15px] text-muted-foreground">
            {data.items.length === 0 ? "No open recommendations. Run a scan from a client's Agents tab." : "Nothing matches these filters."}
          </div>
        ) : items.map((i) => (
          <QueueItem key={`${i.clientSlug}|${i.key}`} item={i} client={clients.get(i.clientSlug)} people={data.people} isOwner={data.isOwner} me={data.me}
            onChange={(c) => patchItem(i.key, i.clientSlug, c)} />
        ))}
      </div>
    </div>
  );
}

function QueueItem({ item, client, people, isOwner, me, onChange }: {
  item: Item; client?: Client; people: Person[]; isOwner: boolean; me: number | null; onChange: (c: Partial<Item> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"assign" | null>(null);
  const [context, setContext] = useState(item.context);
  const [pick, setPick] = useState<number | null>(item.assigned?.assigneeId ?? null);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The full card (draft and all), loaded when there's a draft to show.
  const [full, setFull] = useState<{ task: StoredTask; webflow: boolean } | null>(null);
  const cat = CATEGORIES[item.category] || CATEGORIES.upkeep;
  const hasDraft = item.status === "drafted" || item.status === "applied" || !!full?.task.output;

  useEffect(() => {
    if (!open || full || !(item.status === "drafted" || item.status === "applied")) return;
    let alive = true;
    fetch(`/api/agents/task?client=${encodeURIComponent(item.clientSlug)}&key=${encodeURIComponent(item.key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.task) setFull({ task: d.task, webflow: d.webflow.connected }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, full, item.status, item.clientSlug, item.key]);

  // Same Apply actions as the Agents tab card.
  const post: Post = async (body) => {
    const res = await fetch("/api/agents/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: item.clientSlug, key: item.key, ...body }) });
    return res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  };
  const assignee = item.assigned?.assigneeId ? people.find((p) => p.id === item.assigned!.assigneeId) : undefined;
  const canRun = item.type !== "link_prospect";
  const agentsHref = `/${item.clientSlug}?section=agents`;

  async function run() {
    setBusy("run"); setError(null); setOpen(true);
    try {
      const r = await fetch("/api/agents/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: item.clientSlug, key: item.key, context }) });
      const d = await r.json().catch(() => ({ error: "The agent took too long to answer. Try again." }));
      if (!d.ok) throw new Error(d.error || "The agent hit an error.");
      onChange({ status: d.status, draftSummary: d.output?.summary || null, context });
      // Show the draft in full, exactly as the Agents tab does.
      const t = await fetch(`/api/agents/task?client=${encodeURIComponent(item.clientSlug)}&key=${encodeURIComponent(item.key)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (t?.task) setFull({ task: t.task, webflow: t.webflow.connected });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The agent hit an error.");
    } finally { setBusy(null); }
  }
  async function assign() {
    if (pick === null) return;
    if (pick === AGENT) {
      // Hand it to the agent: track it on the Work board as agent-only (unless a
      // person already has it), then draft the fix now.
      setMode(null);
      if (!item.assigned) {
        const r = await fetch("/api/work-tasks/from-agent", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client: item.clientSlug, key: item.key, assigneeId: null, context, dueDate: due || undefined }) }).catch(() => null);
        const d = r && r.ok ? await r.json() : null;
        if (d?.task) onChange({ assigned: { taskId: d.task.id, assigneeId: null, workStatus: d.task.status } });
      }
      return run();
    }
    setBusy("assign"); setError(null);
    try {
      const r = await fetch("/api/work-tasks/from-agent", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: item.clientSlug, key: item.key, assigneeId: pick, context, dueDate: due || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't assign it.");
      onChange({ assigned: { taskId: d.task.id, assigneeId: d.task.assigneeId, workStatus: d.task.status }, context });
      setMode(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't assign it.");
    } finally { setBusy(null); }
  }
  async function dismiss() {
    setBusy("dismiss");
    const r = await fetch("/api/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: item.clientSlug, key: item.key, status: "dismissed" }) });
    setBusy(null);
    if (r.ok) onChange(null); else setError("Couldn't dismiss it.");
  }

  return (
    <article className="rounded-2xl card-depth card-lift p-4 anim-rise">
      <div className="flex flex-wrap items-start gap-3">
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
            {client && <span className="inline-flex items-center gap-1.5 font-semibold text-[#1D475E]"><ClientLogo logo={client.logo} name={client.name} size={18} />{client.name}</span>}
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold" style={{ color: cat.color, background: `${cat.color}14` }}><cat.Icon size={12} />{cat.label}</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${IMPACT[item.impact].cls}`}>{IMPACT[item.impact].label}</span>
            {item.status === "drafted" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Draft ready</span>}
            {item.status === "applied" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">Applied</span>}
            <span className="text-muted-foreground">· {ago(item.createdAt)}</span>
          </div>
          <p className="text-[16px] font-semibold leading-snug text-[#001A2E]">{item.title}</p>
          <p className={`mt-1 text-[14px] text-[#001A2E]/70 ${open ? "" : "line-clamp-2"}`}>{item.why}</p>
        </button>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {isOwner ? (
            <button onClick={() => { setMode(mode === "assign" ? null : "assign"); setOpen(true); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white pl-2 pr-2.5 text-[13px] font-semibold text-[#01384C] shadow-[0_1px_2px_rgba(7,61,143,0.06),0_3px_8px_rgba(7,61,143,0.05)] transition-all duration-200 hover:shadow-[0_1px_2px_rgba(7,61,143,0.08),0_6px_14px_rgba(7,61,143,0.08)]">
              {assignee ? <Avatar id={assignee.id} name={assignee.name} photoVersion={assignee.photoVersion} size={22} /> : item.assigned ? <Bot size={15} /> : <UserPlus size={15} />}
              {assignee ? assignee.name.split(" ")[0] : item.assigned ? "Agent" : "Assign"}
            </button>
          ) : item.assigned?.assigneeId === me && me !== null ? (
            <Link href={`/work?task=${item.assigned.taskId}`} className="inline-flex items-center gap-1.5 rounded-full bg-[#0CA4C3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0F6E84]"><Check size={13} /> Assigned to you</Link>
          ) : null}
          {canRun ? (
            <button onClick={run} disabled={busy === "run"} title="The agent drafts the fix. Nothing changes on the site until you apply it." className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3 text-[13px] font-semibold text-white shadow-[0_2px_6px_rgba(12,164,195,0.3)] transition-all duration-200 hover:bg-[#0394B2] disabled:opacity-70">
              {busy === "run" ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
              {busy === "run" ? "Drafting…" : hasDraft ? "Run again" : "Fix with agent"}
            </button>
          ) : hasDraft ? (
            // Link prospects arrive with the research and pitch already written.
            <button onClick={() => setOpen(!open)} title="Researched in Claude Code, with the pitch already written." className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0CA4C3] px-3 text-[13px] font-semibold text-white shadow-[0_2px_6px_rgba(12,164,195,0.3)] transition-all duration-200 hover:bg-[#0394B2]">
              <Bot size={14} /> {open ? "Hide the pitch" : "See the pitch"}
            </button>
          ) : null}
          <button onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-slate-100">
            <ChevronDown size={16} className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-border/60 pt-4 anim-rise">
          {item.evidence.length > 0 && (
            <ul className="space-y-1 text-[13px] text-[#001A2E]/80">
              {item.evidence.map((e, n) => <li key={n} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-[#001A2E]/40" />{e}</li>)}
            </ul>
          )}

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Extra context (goes to the agent and to whoever you assign)</span>
            <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} placeholder="e.g. Use the client's new pricing, keep it under 150 words, link to /contact"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px] outline-none transition focus:border-[#0CA4C3]/50 focus:ring-2 focus:ring-[#0CA4C3]/15" />
          </label>

          {busy === "run" && (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#0CA4C3]/40 bg-[#0CA4C3]/[0.04] px-4 py-4 text-[14px] text-[#01384C]">
              <Loader2 size={16} className="animate-spin text-[#0CA4C3]" /> The agent is reading the page and the data, then drafting. Usually 30 to 90 seconds.
            </div>
          )}
          {mode === "assign" && isOwner && (
            <div className="space-y-3 rounded-xl border border-[#0CA4C3]/25 bg-[#0CA4C3]/[0.04] p-3 anim-pop" style={{ transformOrigin: "top center" }}>
              <p className="text-[13px] font-semibold text-[#131B30]">Assign to</p>
              <div className="flex flex-wrap gap-2">
                {canRun && (
                  <button onClick={() => setPick(AGENT)} aria-pressed={pick === AGENT}
                    className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[13px] transition-all duration-200 ${pick === AGENT ? "border-[#0CA4C3] bg-white font-semibold text-[#131B30] shadow-[0_2px_8px_rgba(12,164,195,0.2)]" : "border-border bg-white/70 text-[#3E4F5E] hover:bg-white"}`}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0CA4C3] text-white"><Bot size={13} /></span>Agent
                  </button>
                )}
                {people.length === 0 && <span className="text-[13px] text-muted-foreground">Add people on the Team page first.</span>}
                {people.map((p) => (
                  <button key={p.id} onClick={() => setPick(p.id)} aria-pressed={pick === p.id}
                    className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[13px] transition-all duration-200 ${pick === p.id ? "border-[#0CA4C3] bg-white font-semibold text-[#131B30] shadow-[0_2px_8px_rgba(12,164,195,0.2)]" : "border-border bg-white/70 text-[#3E4F5E] hover:bg-white"}`}>
                    <Avatar id={p.id} name={p.name} photoVersion={p.photoVersion} size={24} />{p.name}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[12px] text-muted-foreground">Due date
                  <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="mt-0.5 block rounded-md border border-border bg-white px-2 py-1.5 text-[14px]" />
                </label>
                <button onClick={assign} disabled={pick === null || busy === "assign"} className="btn-mmg-blue inline-flex items-center gap-1.5 px-4 py-2 text-[14px] disabled:opacity-50">
                  {busy === "assign" && <Loader2 size={14} className="animate-spin" />}
                  {pick === AGENT ? "Hand to the agent" : pick !== null ? `Assign to ${people.find((p) => p.id === pick)?.name.split(" ")[0] || ""}` : "Pick someone"}
                </button>
                <button onClick={() => setMode(null)} className="rounded-md px-3 py-2 text-[13px] text-[#3E4F5E] hover:bg-white">Cancel</button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {pick === AGENT ? "The agent drafts the fix now, using your context. It's tracked on the Work board; nothing changes on the site until you apply it." : "They get an email and it lands in their queue, with your context at the top."}
              </p>
            </div>
          )}

          {busy !== "run" && full?.task.output ? (
            <div className="rounded-xl border border-emerald-200/70 bg-white p-4 anim-rise">
              <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-emerald-700"><Bot size={13} /> Agent draft · review, then apply</p>
              <OutputView key={(full.task.output as AgentOutput).generatedAt} task={full.task} out={full.task.output as AgentOutput} post={post} webflowConnected={full.webflow}
                onResult={(result, status) => { setFull((f) => f && { ...f, task: { ...f.task, result, ...(status ? { status } : {}) } }); if (status) onChange({ status: status as Item["status"] }); }}
                onOutput={(output) => setFull((f) => f && { ...f, task: { ...f.task, output } })} />
            </div>
          ) : busy !== "run" && item.draftSummary ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50/60 px-4 py-3 text-[14px] text-[#01384C]">
              <Loader2 size={14} className="animate-spin text-emerald-700" /> Loading the draft…
            </div>
          ) : null}

          {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}

          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <Link href={agentsHref} className="inline-flex items-center gap-1 font-medium text-[#0394B2] hover:underline">Open in {client?.name || "the client"}&apos;s Agents tab <ExternalLink size={12} /></Link>
            {item.assigned && <Link href={`/work?task=${item.assigned.taskId}`} className="inline-flex items-center gap-1 font-medium text-[#0394B2] hover:underline">Open the Work task <ExternalLink size={12} /></Link>}
            {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:underline">Open the page <ExternalLink size={12} /></a>}
            <span className="flex-1" />
            <button onClick={dismiss} disabled={busy === "dismiss"} className="inline-flex items-center gap-1 text-muted-foreground hover:text-red-600"><X size={13} /> Dismiss</button>
          </div>
        </div>
      )}
    </article>
  );
}
