"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { HoverPanel } from "@/components/ui/hover-panel";
import { ArrowDownRight, ArrowUpRight, Check, Link2, Loader2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import type { AiAnswer, AiPrompt, AiVisibility } from "@/lib/airt";
import { lighten } from "@/lib/source-colors";

type ApiResult = AiVisibility | { status: "no_seranking" | "error"; message: string };

function isAiData(d: ApiResult | null): d is AiVisibility {
  return !!d && "engines" in d;
}

// One color per AI engine (from the dashboard's colorblind-checked palette),
// always paired with the engine's name.
const ENGINE_COLORS: Record<string, string> = {
  chatgpt: "#1baf7a",
  google_ai_overview: "#eb6834",
  perplexity: "#4a3aa7",
  gemini: "#2a78d6",
  google_ai_mode: "#eda100",
};
const SETUP_ENGINES = [
  { key: "chatgpt", label: "ChatGPT", default: true },
  { key: "google_ai_overview", label: "Google AI Overview", default: true },
  { key: "perplexity", label: "Perplexity", default: true },
  { key: "gemini", label: "Gemini", default: true },
  { key: "google_ai_mode", label: "Google AI Mode", default: false },
];

const eyebrow = "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";

function pct(v: number | null) {
  if (v == null) return "—";
  return `${Math.round(v)}%`;
}

function Diff({ value }: { value: number | null }) {
  if (value == null || Math.round(value) === 0) return <span className="text-[13px] text-muted-foreground">no change</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${up ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {up ? "+" : ""}{Math.round(value)} pts
    </span>
  );
}

// ── Answer viewer (prompt row hover) ───────────────────────────────────────

const answerCache = new Map<string, AiAnswer | "error">();

function AnswerPanel({ prompt, data, clientSlug }: { prompt: AiPrompt; data: AiVisibility; clientSlug: string }) {
  const answered = data.engines.filter((e) => prompt.byEngine[e.id]?.date && prompt.byEngine[e.id]?.promptLlmId);
  const [engineId, setEngineId] = useState<number | null>(answered[0]?.id ?? null);
  const result = engineId != null ? prompt.byEngine[engineId] : undefined;
  const key = result ? `${engineId}:${result.promptLlmId}:${result.date}` : "";
  const [answer, setAnswer] = useState<AiAnswer | "error" | null>(key ? answerCache.get(key) ?? null : null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!result || !key) return;
    const cached = answerCache.get(key);
    if (cached) { setAnswer(cached); return; }
    setAnswer(null);
    let cancelled = false;
    fetch(`/api/ai-visibility/answer?client=${clientSlug}&llm=${engineId}&promptLlmId=${result.promptLlmId}&date=${result.date}`)
      .then((r) => r.json())
      .then((json) => {
        const value: AiAnswer | "error" = json.error ? "error" : json;
        answerCache.set(key, value);
        if (!cancelled) setAnswer(value);
      })
      .catch(() => !cancelled && setAnswer("error"));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const brandLower = (data.brand || "").toLowerCase();

  return (
    <div className="space-y-3.5">
      <p className="text-[15px] font-semibold leading-snug text-[#001A2E]">&ldquo;{prompt.prompt}&rdquo;</p>
      {answered.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No AI answers recorded for this prompt in this window.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {answered.map((e) => (
              <button
                key={e.id}
                onClick={() => { setEngineId(e.id); setExpanded(false); }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors ${engineId === e.id ? "border-[#001A2E] bg-[#001A2E] text-white" : "border-border bg-white text-foreground/75 hover:border-[#001A2E]/30"}`}
              >
                <span className="size-2 rounded-full" style={{ background: ENGINE_COLORS[e.key] }} />
                {e.name}
              </button>
            ))}
          </div>

          {!answer ? (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading the answer…</p>
          ) : answer === "error" ? (
            <p className="text-[13px] text-muted-foreground">This answer isn&apos;t available anymore (SE Ranking keeps answer text for 30 days).</p>
          ) : (
            <>
              <div>
                <div className={`${eyebrow} mb-1.5`}>Brands named, in order</div>
                {answer.brands.length ? (
                  <ol className="space-y-1">
                    {answer.brands.slice(0, 6).map((b) => {
                      const you = b.name.toLowerCase() === brandLower;
                      return (
                        <li key={b.name} className={`flex items-center gap-2 text-[13px] ${you ? "font-semibold text-[#001A2E]" : "text-foreground/80"}`}>
                          <span className="w-5 text-right tabular-nums text-muted-foreground">{b.position}.</span>
                          {b.name}
                          {you && <span className="rounded bg-[#0CA4C3]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#0394B2]">You</span>}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="text-[13px] text-muted-foreground">The answer didn&apos;t name any brands.</p>
                )}
              </div>
              {answer.text && (
                <div>
                  <div className={`${eyebrow} mb-1.5`}>What it said · {answer.date}</div>
                  <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/80">
                    {expanded || answer.text.length <= 420 ? answer.text : `${answer.text.slice(0, 420).trimEnd()}…`}
                  </p>
                  {answer.text.length > 420 && (
                    <button onClick={() => setExpanded((v) => !v)} className="mt-1 text-[13px] font-semibold text-[#0394B2] hover:text-[#001A2E]">
                      {expanded ? "Show less" : "Read the full answer"}
                    </button>
                  )}
                </div>
              )}
              {answer.sources.length > 0 && (
                <div>
                  <div className={`${eyebrow} mb-1.5`}>Sources it cited</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set(answer.sources.map((s) => { try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return s.url; } }))].slice(0, 8).map((d) => (
                      <span key={d} className="rounded-md bg-[#001A2E]/[0.05] px-2 py-0.5 text-[12px] text-foreground/80">{d}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function PromptCell({ r }: { r?: AiPrompt["byEngine"][number] }) {
  if (!r || r.mentionPosition == null) return <span className="text-[13px] text-muted-foreground/70">—</span>;
  if (r.mentionPosition === 0) return <span className="text-[12px] text-muted-foreground">Not named</span>;
  const top = r.mentionPosition <= 3;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex min-w-[34px] justify-center rounded-md border px-1.5 py-0.5 text-[13px] font-semibold tabular-nums ${top ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-muted/60 text-foreground/75"}`}>
        #{r.mentionPosition}
      </span>
      {r.linked && <span title="Also linked to the site"><Link2 size={13} className="text-[#0394B2]" /></span>}
    </span>
  );
}

// ── Setup for clients that aren't tracked yet ──────────────────────────────

function AiSetup({ clientSlug, clientName, defaultBrand, onDone }: {
  clientSlug: string;
  clientName: string;
  defaultBrand: string | null;
  onDone: () => void;
}) {
  const [prompts, setPrompts] = useState<string[] | null>(null);
  const [basedOn, setBasedOn] = useState<string[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [engines, setEngines] = useState<string[]>(SETUP_ENGINES.filter((e) => e.default).map((e) => e.key));
  const [brand, setBrand] = useState(defaultBrand || clientName);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ai-visibility/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: clientSlug }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.prompts) { setPrompts(json.prompts); setBasedOn(json.basedOn || []); }
        else { setPrompts([]); setSuggestError(json.error || "Couldn't suggest prompts."); }
      })
      .catch(() => { setPrompts([]); setSuggestError("Couldn't suggest prompts."); });
  }, [clientSlug]);

  const cleanPrompts = (prompts || []).map((p) => p.trim()).filter(Boolean);

  async function start() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-visibility/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug, prompts: cleanPrompts, engines, brand }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Setup failed");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-7">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="size-9 rounded-xl bg-[#0CA4C3]/10 text-[#0394B2] flex items-center justify-center"><Sparkles size={17} /></span>
            <p className="font-headline text-[24px] text-[#001A2E]">Start tracking AI search visibility</p>
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Each day SE Ranking asks AI assistants the prompts below and records whether they name {clientName}, which competitors they name instead, and which websites they cite. Review the prompts, then start tracking. First results appear within about a day.
          </p>
        </div>

        <section>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <p className="text-[16px] font-semibold text-[#001A2E]">Prompts to track</p>
            {basedOn.length > 0 && (
              <p className="text-[13px] text-muted-foreground truncate">Based on: {basedOn.slice(0, 4).join(", ")}</p>
            )}
          </div>
          {prompts === null ? (
            <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Writing prompts from this client&apos;s tracked keywords…</p>
          ) : (
            <div className="space-y-2">
              {suggestError && <p className="text-[13px] text-amber-700">{suggestError} Add your own below.</p>}
              {prompts.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={p}
                    maxLength={255}
                    onChange={(e) => setPrompts((cur) => cur!.map((x, j) => (j === i ? e.target.value : x)))}
                    className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/25 focus:border-[#0CA4C3]/40"
                  />
                  <button onClick={() => setPrompts((cur) => cur!.filter((_, j) => j !== i))} className="p-2 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50" aria-label="Remove prompt">
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setPrompts((cur) => [...(cur || []), ""])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[13px] font-semibold text-foreground/75 hover:border-[#0CA4C3]/50 hover:text-[#0394B2]"
              >
                <Plus size={14} /> Add a prompt
              </button>
            </div>
          )}
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-[16px] font-semibold text-[#001A2E] mb-3">AI assistants</p>
            <div className="flex flex-wrap gap-2">
              {SETUP_ENGINES.map((e) => {
                const on = engines.includes(e.key);
                return (
                  <button
                    key={e.key}
                    onClick={() => setEngines((cur) => (on ? cur.filter((k) => k !== e.key) : [...cur, e.key]))}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${on ? "border-[#001A2E] bg-[#001A2E] text-white" : "border-border bg-white text-foreground/70"}`}
                  >
                    {on ? <Check size={13} /> : <span className="size-2 rounded-full" style={{ background: ENGINE_COLORS[e.key] }} />}
                    {e.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-[16px] font-semibold text-[#001A2E] mb-3">Brand name to look for</p>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#0CA4C3]/25"
            />
            <p className="mt-1 text-[12px] text-muted-foreground">How AI assistants would write the business&apos;s name.</p>
          </div>
        </section>

        {error && <p className="text-[14px] text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
          <p className="text-[13px] text-muted-foreground">
            {cleanPrompts.length} prompts × {engines.length} assistants = {cleanPrompts.length * engines.length} checks a day from your SE Ranking AI tracking allowance.
          </p>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-[14px] text-foreground/80">Create these in SE Ranking?</span>
              <button onClick={() => setConfirming(false)} disabled={saving} className="rounded-lg border border-border bg-white px-3.5 py-2 text-[14px] font-semibold text-[#001A2E]">Cancel</button>
              <button onClick={start} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#001A2E] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#01384C] disabled:opacity-50">
                {saving && <Loader2 size={14} className="animate-spin" />} Yes, start tracking
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={cleanPrompts.length === 0 || engines.length === 0 || !brand.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#001A2E] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#01384C] disabled:opacity-40"
            >
              <Sparkles size={15} /> Start tracking
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── The tab ────────────────────────────────────────────────────────────────

export function AiVisibilityTab({ clientSlug, clientName, range }: { clientSlug: string; clientName: string; range: string }) {
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(true);

  function fetchData(fresh: boolean) {
    return fetch(`/api/ai-visibility?client=${clientSlug}&range=${range}${fresh ? `&_t=${Date.now()}` : ""}`)
      .then((r) => r.json() as Promise<ApiResult>)
      .catch((): ApiResult => ({ status: "error", message: "Couldn't load AI visibility." }));
  }

  // Refresh button and post-setup reload.
  function load(fresh = false) {
    setLoading(true);
    fetchData(fresh).then((d) => { setData(d); setLoading(false); });
  }

  useEffect(() => {
    let cancelled = false;
    fetchData(false).then((d) => {
      if (!cancelled) { setData(d); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [clientSlug, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <div className="px-1 flex items-start justify-between gap-4">
      <div>
        <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0394B2] mb-1.5">AI search visibility</div>
        <h2 className="font-headline text-[28px] text-[#001A2E]">How AI assistants talk about {clientName}</h2>
        <p className="mt-1 text-[15px] text-muted-foreground max-w-2xl">
          Whether ChatGPT, Google&apos;s AI answers, Perplexity, and Gemini recommend this business when people ask the questions it should be found for.
        </p>
      </div>
      {data && "engines" in data && data.engines.length > 0 && (
        <button onClick={() => load(true)} disabled={loading} title="Refresh" className="p-2 rounded-md text-muted-foreground hover:text-[#001A2E] hover:bg-muted/40 disabled:opacity-30">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      )}
    </div>
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        {header}
        <Card><CardContent className="py-14 flex items-center justify-center gap-2 text-[15px] text-muted-foreground"><Loader2 size={17} className="animate-spin" /> Asking SE Ranking for the latest AI answers…</CardContent></Card>
      </div>
    );
  }

  if (!isAiData(data)) {
    return (
      <div className="space-y-6">
        {header}
        <Card><CardContent className="py-10 text-center text-[15px] text-muted-foreground">{data?.message || "Couldn't load AI visibility."}</CardContent></Card>
      </div>
    );
  }

  if (data.status === "not_set_up") {
    return (
      <div className="space-y-6">
        {header}
        <AiSetup clientSlug={clientSlug} clientName={clientName} defaultBrand={data.brand} onDone={() => load(true)} />
      </div>
    );
  }

  const maxCompetitor = Math.max(...data.competitors.map((c) => c.inAnswers), 1);
  const you = data.competitors.find((c) => c.isYou);
  const days = Math.round((Date.parse(data.dateTo) - Date.parse(data.dateFrom)) / 86_400_000) + 1;

  return (
    <div className="space-y-8">
      {header}

      {data.status === "collecting" && (
        <div className="rounded-xl border border-[#0CA4C3]/30 bg-[#0CA4C3]/[0.06] px-4 py-3 text-[14px] text-[#01384C]">
          Tracking is set up. SE Ranking checks each prompt once a day, so the first answers appear within about 24 hours.
        </div>
      )}

      {/* Per-engine scorecards */}
      <div className={`grid gap-5 grid-cols-2 ${data.engines.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} ${data.engines.length >= 5 ? "2xl:grid-cols-5" : ""}`}>
        {data.engines.map((e) => (
          <Card key={e.id}>
            <CardContent>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: ENGINE_COLORS[e.key] }} />
                <span className="text-[14px] font-semibold text-[#001A2E]">{e.name}</span>
              </div>
              <div className={`${eyebrow} mt-4`}>Names {clientName}</div>
              <div className="mt-1.5 flex items-end gap-2">
                <span className="text-[36px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#001A2E]">{pct(e.mentionPct)}</span>
                <span className="pb-1"><Diff value={e.mentionDiff} /></span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-[#001A2E]/[0.05] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(e.mentionPct || 0, 100)}%`, background: `linear-gradient(90deg, ${lighten(ENGINE_COLORS[e.key] || "#0CA4C3")}, ${ENGINE_COLORS[e.key] || "#0CA4C3"})` }} />
              </div>
              <p className="mt-3 text-[13px] text-muted-foreground">
                Links to the site in {pct(e.linkPct)} · {e.promptsCount} prompts
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        {/* Share of voice */}
        <Card>
          <CardContent>
            <p className="font-headline text-[22px] text-[#001A2E]">Share of voice</p>
            <p className="mt-0.5 mb-5 text-[14px] text-muted-foreground">How often each business was named in AI answers, last {days} days.</p>
            <div className="space-y-3.5">
              {data.competitors.slice(0, 8).map((c) => (
                <div key={c.name}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[14px] truncate ${c.isYou ? "font-semibold text-[#001A2E]" : "font-medium text-foreground/80"}`}>{c.name}</span>
                    {c.isYou && <span className="rounded bg-[#0CA4C3]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#0394B2]">You</span>}
                    <span className="ml-auto text-[14px] font-semibold tabular-nums text-[#001A2E]">{c.inAnswers.toLocaleString()}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#001A2E]/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(c.inAnswers / maxCompetitor) * 100}%`,
                        background: c.isYou ? "linear-gradient(90deg, #6fd3e4, #0CA4C3)" : "linear-gradient(90deg, #c7d3d8, #8fa3ad)",
                      }}
                    />
                  </div>
                </div>
              ))}
              {!you && data.brand && (
                <p className="text-[13px] text-muted-foreground">{data.brand} wasn&apos;t named in any tracked answer this period.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Opportunities + sources */}
        <Card>
          <CardContent>
            <p className="font-headline text-[22px] text-[#001A2E]">Where to get mentioned</p>
            <p className="mt-0.5 mb-5 text-[14px] text-muted-foreground">AI assistants lean on the sites below. Getting named on the ones that skip you is the fastest way into their answers.</p>
            {data.opportunities && (
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: "Answers naming only competitors", value: data.opportunities.competitorOnlyMentions },
                  { label: "Cited pages that skip you", value: data.opportunities.mentionOpportunities },
                  { label: "Mentions without a link", value: data.opportunities.mentionsWithoutBacklinks },
                ].map((t) => (
                  <div key={t.label} className="rounded-xl bg-[#f7fafb] border border-border p-3">
                    <div className="text-[22px] font-semibold tabular-nums text-[#001A2E]">{t.value.toLocaleString()}</div>
                    <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{t.label}</div>
                  </div>
                ))}
              </div>
            )}
            <div className={`${eyebrow} mb-2`}>Most-cited sites</div>
            <div className="divide-y divide-border/60">
              {data.sources.slice(0, 8).map((s) => (
                <div key={s.domain} className="flex items-center gap-3 py-2">
                  <span className={`flex-1 min-w-0 truncate text-[14px] ${s.isYou ? "font-semibold text-[#001A2E]" : "text-foreground/85"}`}>{s.domain}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{s.aiAnswers.toLocaleString()} answers</span>
                  {s.isYou ? (
                    <span className="shrink-0 rounded bg-[#0CA4C3]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#0394B2]">Your site</span>
                  ) : s.mentionsYou ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><Check size={12} /> Names you</span>
                  ) : (
                    <span className="shrink-0 text-[12px] font-semibold text-amber-700">Skips you</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Prompts */}
      <Card>
        <CardContent>
          <p className="font-headline text-[22px] text-[#001A2E]">Tracked prompts</p>
          <p className="mt-0.5 mb-5 text-[14px] text-muted-foreground">
            Where {clientName} appears in each AI answer (#1 = named first). Hover a prompt to read what the AI actually said.
          </p>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div
                className="grid items-center gap-3 px-2 pb-2 border-b border-border"
                style={{ gridTemplateColumns: `1fr repeat(${data.engines.length}, 108px)` }}
              >
                <span className={eyebrow}>Prompt</span>
                {data.engines.map((e) => (
                  <span key={e.id} className={`${eyebrow} text-center flex items-center justify-center gap-1.5`}>
                    <span className="size-2 rounded-full" style={{ background: ENGINE_COLORS[e.key] }} />
                    <span className="truncate">{e.name.replace("Google ", "")}</span>
                  </span>
                ))}
              </div>
              <div className="divide-y divide-border/60">
                {data.prompts.map((p) => (
                  <HoverPanel key={p.promptId} width={420} content={() => <AnswerPanel prompt={p} data={data} clientSlug={clientSlug} />}>
                    <div
                      className="grid items-center gap-3 px-2 py-3 cursor-default"
                      style={{ gridTemplateColumns: `1fr repeat(${data.engines.length}, 108px)` }}
                    >
                      <span className="text-[14px] leading-snug text-foreground/90">{p.prompt}</span>
                      {data.engines.map((e) => (
                        <span key={e.id} className="flex justify-center"><PromptCell r={p.byEngine[e.id]} /></span>
                      ))}
                    </div>
                  </HoverPanel>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
