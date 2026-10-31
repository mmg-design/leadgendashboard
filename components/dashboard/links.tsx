"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, Bot, ExternalLink, Link2, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { TaskCard } from "@/components/dashboard/agents";
import { LinkProspects } from "@/components/dashboard/link-prospects";
import type { BacklinkReport } from "@/lib/backlinks";
import type { StoredTask } from "@/lib/agent-tasks";

const GREEN = "#008300"; // the Links category color in Agents
const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const btnSecondary = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[14px] font-medium text-[#001A2E] hover:bg-muted/50 disabled:opacity-50 transition-colors";
const axisTick = { fill: "#365f6d", fontSize: 12 };
const IMPACT_RANK = { high: 0, medium: 1, low: 2 };

interface AgentsData { tasks: StoredTask[]; webflow: { connected: boolean }; clickup: boolean }

function timeAgo(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "just now";
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
const monthLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: "short" });

function Section({ title, note, children, action }: { title: string; note?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-semibold text-[#001A2E]">{title}</h3>
            {note && <p className="mt-0.5 text-[14px] text-muted-foreground">{note}</p>}
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

// Authority as a small bar, so a column of them reads at a glance. The number
// is always printed beside it.
function Authority({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[#001A2E]/[0.07]">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(4, value)}%`, background: GREEN }} />
      </span>
      <span className="w-6 text-right tabular-nums text-[13px] text-[#001A2E]">{value}</span>
    </span>
  );
}

function Site({ domain }: { domain: string }) {
  return (
    <a href={`https://${domain}`} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-[#001A2E] hover:text-[#0394B2]">
      <span className="truncate">{domain}</span> <ExternalLink size={11} className="shrink-0 opacity-50" />
    </a>
  );
}

function HistoryTooltip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; backlinks: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg bg-[#001A2E] px-3 py-2 text-[13px] text-white shadow-lg">
      <p className="text-white/70">Week of {shortDate(p.date)}</p>
      <p className="font-semibold tabular-nums">{p.backlinks.toLocaleString()} backlinks</p>
    </div>
  );
}

export function LinksTab({ clientSlug, clientName, onOpenAgents }: { clientSlug: string; clientName: string; onOpenAgents: () => void }) {
  const [report, setReport] = useState<(BacklinkReport & { stale?: boolean }) | null>(null);
  const [agents, setAgents] = useState<AgentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState(false);

  // The report loads first: the Agents scan reuses it from the cache instead
  // of asking SE Ranking a second time.
  async function load(fresh = false) {
    try {
      const r = await fetch(`/api/backlinks?client=${clientSlug}${fresh ? "&fresh=1" : ""}`).then((res) => res.json());
      // A failed refresh keeps showing the last report.
      if (r.error) { if (fresh) setRefreshError(r.error); else setError(r.error); return; }
      setError(null); setRefreshError(null);
      setReport(r);
      setLoading(false);
      // A week-old report shows at once and refreshes behind it.
      if (r.stale && !fresh) { setRefreshing(true); return load(true); }
      const a = await fetch(`/api/agents?client=${clientSlug}${fresh ? "&scan=1" : ""}`).then((res) => res.json());
      if (!a.error) setAgents(a);
    } catch {
      if (fresh) setRefreshError("Couldn't reach SE Ranking. Try again in a minute.");
      else setError("Couldn't reach SE Ranking. Try again in a minute.");
    } finally {
      setLoading(false);
      if (fresh) setRefreshing(false);
    }
  }
  useEffect(() => { load(); }, [clientSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const linkTasks = useMemo(
    () => (agents?.tasks || [])
      .filter((t) => t.category === "links" && t.type !== "link_prospect" && (t.status === "open" || t.status === "drafted" || t.status === "applied"))
      .sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || b.score - a.score),
    [agents],
  );
  function replace(updated: StoredTask) {
    setAgents((d) => (d ? { ...d, tasks: d.tasks.map((t) => (t.key === updated.key ? updated : t)) } : d));
  }

  if (loading) {
    return <Card><CardContent className="py-14 flex items-center justify-center gap-2 text-[15px] text-muted-foreground"><Loader2 size={17} className="animate-spin" /> Pulling the backlink report from SE Ranking. The first one takes about a minute…</CardContent></Card>;
  }
  if (error || !report) {
    return <Card><CardContent className="py-10 text-center text-[15px] text-muted-foreground">{error || "No backlink data yet."}</CardContent></Card>;
  }

  const t = report.totals;
  const realRecent = report.recent.filter((r) => !r.junk);
  const gained = realRecent.filter((r) => r.type === "new").length;
  const lost = realRecent.filter((r) => r.type === "lost").length;
  const comparison = [{ domain: report.domain, refdomains: t.refdomains, authority: t.authority, you: true }, ...report.competitors.map((c) => ({ ...c, you: false }))]
    .sort((a, b) => b.authority - a.authority);
  const maxRd = Math.max(1, ...comparison.map((c) => c.refdomains));
  const brokenPages = report.pages.filter((p) => p.status === 404 || p.status === 410);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0394B2] mb-1.5">Links</div>
          <h2 className="font-headline text-[28px] text-[#001A2E]">Backlinks for {clientName}</h2>
          <p className="mt-1 max-w-[720px] text-[15px] text-muted-foreground">
            Who links to {report.domain}, what changed, and the sites worth a link next. Prospects and fixes are also in Agents, under Links.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[13px] ${refreshError ? "text-red-600" : "text-muted-foreground"}`} title={refreshError || "SE Ranking charges credits per lookup, so the report refreshes weekly"}>
            {refreshing ? "Updating from SE Ranking, about a minute…" : refreshError ? `Refresh failed. Showing the report from ${timeAgo(report.fetchedAt)}` : `From SE Ranking, ${timeAgo(report.fetchedAt)}`}
          </span>
          <button className={btnSecondary} disabled={refreshing} onClick={() => { setRefreshing(true); load(true); }}>
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button className={btnSecondary} onClick={onOpenAgents}><Bot size={14} /> Open in Agents</button>
        </div>
      </div>

      {report.junkBurst && (
        <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-[14px] text-[#001A2E]">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">{report.junkBurst.count} junk links arrived between {shortDate(report.junkBurst.from)} and {shortDate(report.junkBurst.to)}</p>
            <p className="mt-0.5 text-[#001A2E]/75">
              Automated link farms ({report.junkBurst.sample.slice(0, 2).join(", ")} and others). Google ignores links like these, so they&apos;re left out of the real link count below. There&apos;s a check for it under Fixes and lost links.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <StatCard title="Real linking sites" value={t.realRefdomains.toLocaleString()} subtitle={`of ${t.refdomains.toLocaleString()} in total; ${t.junkRefdomains} look like junk`} tooltip="Different websites linking to the client, after removing automated link farms. One good site counts once however many links it has." />
        <StatCard title="Domain authority" value={`${t.authority}`} subtitle="SE Ranking's 0-100 score" tooltip="SE Ranking's Domain InLink Rank. It grows as stronger sites link to the domain. Compare it with competitors rather than reading it alone." />
        <StatCard title="Followed links" value={(t.realFollowed ?? t.dofollowRefdomains).toLocaleString()} subtitle="real sites whose links pass ranking value" tooltip="Real linking sites with at least one followed link. Nofollow links still send visitors but pass little ranking value." />
        <StatCard title="Last 30 days" value={`+${gained} / −${lost}`} subtitle="real sites gained / lost" tooltip="Referring domains SE Ranking found or lost in the last 30 days, not counting junk." />
      </div>

      <LinkProspects clientSlug={clientSlug} clientName={clientName} />

      <div className="grid gap-6 xl:grid-cols-[1fr_420px] items-start">
        <Section title="Backlinks over the last year" note="Every link SE Ranking can find, junk included, so a sudden jump is usually a link farm.">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={report.history} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="linksFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.22} /><stop offset="100%" stopColor={GREEN} stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(0,26,46,0.06)" />
                <XAxis dataKey="date" tickFormatter={monthLabel} tick={axisTick} axisLine={{ stroke: "rgba(0,26,46,0.1)" }} tickLine={false} minTickGap={36} dy={6} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} allowDecimals={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
                <Tooltip content={<HistoryTooltip />} cursor={{ stroke: "rgba(0,26,46,0.25)" }} wrapperStyle={{ outline: "none" }} />
                <Area type="monotone" dataKey="backlinks" stroke={GREEN} strokeWidth={2} fill="url(#linksFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="How you compare" note="Closest organic competitors, by authority.">
          <div className="space-y-3">
            {comparison.map((c) => (
              <div key={c.domain} className="text-[14px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${c.you ? "font-semibold text-[#001A2E]" : "text-[#001A2E]/85"}`}>{c.you ? `${clientName} (you)` : c.domain}</span>
                  <span className="shrink-0 tabular-nums text-[13px] text-muted-foreground">authority {c.authority} · {c.refdomains.toLocaleString()} sites</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#001A2E]/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${(c.refdomains / maxRd) * 100}%`, background: c.you ? GREEN : "#b4c3c9" }} />
                </div>
              </div>
            ))}
            {report.competitors.length === 0 && <p className="text-[14px] text-muted-foreground">SE Ranking didn&apos;t find organic competitors for this domain yet.</p>}
          </div>
        </Section>
      </div>

      <Section
        title="Fixes and lost links"
        note={`${linkTasks.length} ${linkTasks.length === 1 ? "task" : "tasks"}: redirects for missing pages, links to win back, and checks. Run an agent for the redirect or the email. Nothing is sent for you.`}
        action={<button className="inline-flex items-center gap-1 text-[14px] font-medium text-[#0394B2] hover:underline" onClick={onOpenAgents}>All link tasks <ArrowRight size={14} /></button>}
      >
        {!agents ? (
          <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading tasks…</p>
        ) : linkTasks.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">Nothing to fix. New tasks appear after the weekly refresh.</p>
        ) : (
          <div className="space-y-4">
            {(allTasks ? linkTasks : linkTasks.slice(0, 6)).map((task) => (
              <TaskCard key={task.key} task={task} clientSlug={clientSlug} webflowConnected={agents.webflow.connected} clickupConnected={agents.clickup} onChange={replace} />
            ))}
            {linkTasks.length > 6 && (
              <button className={btnSecondary} onClick={() => setAllTasks(!allTasks)}>
                {allTasks ? "Show the top 6" : `Show all ${linkTasks.length}`}
              </button>
            )}
          </div>
        )}
      </Section>

      <div className="grid gap-6 xl:grid-cols-2 items-start">
        <Section title="Links your competitors have" note="Sites linking to rivals but not to you. Two or more rivals on the same site is the warmest lead.">
          {report.gap.length === 0 ? <p className="text-[14px] text-muted-foreground">No gaps found among the closest competitors.</p> : (
            <table className="w-full text-[14px]">
              <thead><tr className={`${eyebrow} text-left`}><th className="pb-2 font-semibold">Site</th><th className="pb-2 font-semibold">Links to</th><th className="pb-2 font-semibold text-right">Authority</th></tr></thead>
              <tbody className="divide-y divide-border/60">
                {report.gap.slice(0, 12).map((g) => (
                  <tr key={g.domain}>
                    <td className="max-w-[200px] py-2 pr-3"><Site domain={g.domain} /></td>
                    <td className="py-2 pr-3 text-[13px] text-muted-foreground">{g.competitors.length > 1 ? `${g.competitors.length} rivals` : g.competitors[0]}</td>
                    <td className="py-2 text-right"><Authority value={g.authority} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Your strongest links" note="Real sites linking to you, strongest first.">
          <table className="w-full text-[14px]">
            <thead><tr className={`${eyebrow} text-left`}><th className="pb-2 font-semibold">Site</th><th className="pb-2 font-semibold">Since</th><th className="pb-2 font-semibold text-right">Authority</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {report.best.slice(0, 12).map((b) => (
                <tr key={b.domain}>
                  <td className="max-w-[220px] py-2 pr-3"><Site domain={b.domain} />{b.dofollow === 0 && <span className="ml-1.5 text-[12px] text-muted-foreground">nofollow</span>}</td>
                  <td className="py-2 pr-3 text-[13px] text-muted-foreground">{b.firstSeen ? new Date(`${b.firstSeen}T12:00:00`).toLocaleDateString([], { month: "short", year: "numeric" }) : "—"}</td>
                  <td className="py-2 text-right"><Authority value={b.authority} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Lost links" note="Real sites that stopped linking in the last 6 months. Usually a page edit or an expired listing.">
          {report.lost.length === 0 ? <p className="text-[14px] text-muted-foreground">No real links lost in the last 6 months.</p> : (
            <ul className="divide-y divide-border/60 text-[14px]">
              {report.lost.slice(0, 8).map((l) => (
                <li key={l.domain} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <a href={l.urlFrom} target="_blank" rel="noreferrer" className="block truncate font-medium text-[#001A2E] hover:text-[#0394B2]">{l.domain}</a>
                    <p className="truncate text-[13px] text-muted-foreground">{l.title || l.urlFrom} · lost {shortDate(l.date)}</p>
                  </div>
                  <Authority value={l.authority} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Most-linked pages" note="Where links land on the site. A page that no longer loads wastes its links.">
          <ul className="divide-y divide-border/60 text-[14px]">
            {report.pages.map((p) => (
              <li key={p.url} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-[#001A2E]" title={p.url}>{p.path}</span>
                <span className="flex shrink-0 items-center gap-2 text-[13px]">
                  {p.status && p.status >= 400 && <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700">{p.status}</span>}
                  <span className="tabular-nums text-muted-foreground">{p.refdomains} {p.refdomains === 1 ? "site" : "sites"}</span>
                </span>
              </li>
            ))}
          </ul>
          {brokenPages.length > 0 && <p className="text-[13px] text-red-700">{brokenPages.length} linked {brokenPages.length === 1 ? "page is" : "pages are"} missing. The redirect fix is under Fixes and lost links.</p>}
        </Section>
      </div>

      <Section title="Anchor text" note="The words other sites use to link to you. Junk phrases are from link farms.">
        <div className="flex flex-wrap gap-2">
          {report.anchors.map((a, i) => (
            <span key={i} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] ${a.junk ? "border-dashed border-border text-muted-foreground line-through decoration-[#001A2E]/30" : "border-border bg-white text-[#001A2E]"}`}>
              <Link2 size={12} style={{ color: a.junk ? undefined : GREEN }} />
              {a.anchor || "(image or no text)"} <span className="tabular-nums text-muted-foreground">{a.refdomains}</span>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
