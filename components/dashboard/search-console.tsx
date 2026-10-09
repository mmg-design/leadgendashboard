"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import type { GscPage, IndexStatus } from "@/lib/gsc";

export interface GscData {
  status: "ok" | "not_configured" | "api_disabled" | "no_access" | "not_found" | "error";
  message?: string;
  property?: string;
  origin?: string | null;
  pages?: GscPage[];
}

export function IndexBadge({ index }: { index?: IndexStatus }) {
  if (!index) return null;
  return index.indexed ? (
    <span title="Indexed by Google" className="shrink-0 text-emerald-600">
      <CheckCircle2 size={14} />
    </span>
  ) : (
    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
      <AlertCircle size={11} /> Not indexed
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1.5">{children}</div>;
}

// Search Console section of the Top Pages hover card.
export function GscSection({ gsc, page, index, onFix }: {
  gsc: GscData | null;
  page?: GscPage;
  index?: IndexStatus;
  onFix: () => void;
}) {
  if (!gsc) return null;
  if (gsc.status !== "ok") {
    return (
      <p className="text-[13px] text-muted-foreground">
        {gsc.status === "not_configured"
          ? "Connect Google Search Console in Settings to see real Google searches and index status for this page."
          : gsc.message}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {index && (
        <div>
          <SectionTitle>Google index</SectionTitle>
          {index.indexed ? (
            <p className="flex items-center gap-1.5 text-[13px] text-foreground/80">
              <CheckCircle2 size={13} className="text-emerald-600" />
              Indexed{index.lastCrawl ? ` · last crawled ${new Date(index.lastCrawl).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
            </p>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-[13px] font-semibold text-amber-900">{index.coverage}</p>
              {index.reason && <p className="mt-1 text-[13px] leading-snug text-amber-900/80">{index.reason}</p>}
              <button
                onClick={onFix}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[#001A2E] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#01384C] transition-colors"
              >
                Fix indexing
              </button>
            </div>
          )}
        </div>
      )}

      <div>
        <SectionTitle>Google searches (Search Console)</SectionTitle>
        {page ? (
          <>
            <p className="text-[13px] text-muted-foreground mb-2">
              {page.clicks.toLocaleString()} clicks · {page.impressions.toLocaleString()} impressions · avg position {page.position.toFixed(1)}
            </p>
            <div className="space-y-1">
              {page.queries.slice(0, 5).map((q) => (
                <div key={q.query} className="flex items-center gap-2 text-[13px]">
                  <span className="flex-1 min-w-0 truncate text-foreground/90">{q.query}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground" title={`${q.impressions.toLocaleString()} impressions`}>
                    {q.clicks} clicks · #{Math.round(q.position)}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">This page didn&apos;t appear in Google search results in this window.</p>
        )}
      </div>
    </div>
  );
}

// The "Fix indexing" flow. Google offers no API to request indexing for normal
// pages, so this explains the cause, resubmits the sitemap, and sends you to
// Search Console's own "Request indexing" button for the final step.
export function IndexFixDialog({ path, index, clientSlug, origin, onClose, onRecheck }: {
  path: string;
  index: IndexStatus;
  clientSlug: string;
  origin: string;
  onClose: () => void;
  onRecheck: () => Promise<void>;
}) {
  const [sitemapState, setSitemapState] = useState<{ loading: boolean; message: string | null; ok?: boolean }>({ loading: false, message: null });
  const [rechecking, setRechecking] = useState(false);

  async function resubmit() {
    setSitemapState({ loading: true, message: null });
    try {
      const res = await fetch("/api/gsc/sitemap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug, origin }),
      });
      const json = await res.json();
      setSitemapState({
        loading: false,
        ok: !!json.ok,
        message: json.ok ? `Resubmitted ${json.submitted.length === 1 ? "the sitemap" : `${json.submitted.length} sitemaps`} to Google.` : json.message,
      });
    } catch {
      setSitemapState({ loading: false, ok: false, message: "Couldn't reach the server." });
    }
  }

  async function recheck() {
    setRechecking(true);
    try { await onRecheck(); } finally { setRechecking(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#001A2E]/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-[0_24px_64px_rgba(0,26,46,0.24)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Fix indexing</p>
            <h3 className="mt-1 font-headline text-[22px] text-[#001A2E] break-all">{path === "/" ? "Home" : path}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/50" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3.5">
          <p className="text-[14px] font-semibold text-amber-900">{index.coverage}</p>
          {index.reason && <p className="mt-1 text-[14px] leading-relaxed text-amber-900/85">{index.reason}</p>}
        </div>

        <ol className="mt-5 space-y-2.5">
          {index.fixes.map((fix, i) => (
            <li key={fix} className="flex gap-3 text-[14px] leading-relaxed text-foreground/85">
              <span className="size-6 shrink-0 rounded-full bg-[#0CA4C3]/10 text-[#0394B2] text-[12px] font-semibold flex items-center justify-center">{i + 1}</span>
              {fix}
            </li>
          ))}
        </ol>

        {sitemapState.message && (
          <p className={`mt-4 text-[13px] ${sitemapState.ok ? "text-emerald-700" : "text-red-600"}`}>{sitemapState.message}</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
          <button
            onClick={resubmit}
            disabled={sitemapState.loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-[14px] font-semibold text-[#001A2E] hover:bg-[#001A2E]/[0.03] disabled:opacity-50"
          >
            {sitemapState.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Resubmit sitemap
          </button>
          <button
            onClick={recheck}
            disabled={rechecking}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-[14px] font-semibold text-[#001A2E] hover:bg-[#001A2E]/[0.03] disabled:opacity-50"
          >
            {rechecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Re-check status
          </button>
          <a
            href={index.inspectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#001A2E] px-3.5 py-2 text-[14px] font-semibold text-white hover:bg-[#01384C]"
          >
            Request indexing in Google <ExternalLink size={13} />
          </a>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          Google only accepts indexing requests for regular pages through Search Console itself, so the last step opens this page there. Click &quot;Request indexing&quot; once you&apos;ve made the fixes above.
        </p>
      </div>
    </div>,
    document.body
  );
}
