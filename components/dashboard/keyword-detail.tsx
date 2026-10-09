import { ArrowDown, ArrowUp, Sparkles } from "lucide-react";
import type { RankedKeyword } from "@/lib/keyword-insights";

export function competitionLabel(c: number | null | undefined) {
  if (c == null) return "—";
  if (c < 0.34) return "Low";
  if (c < 0.67) return "Medium";
  return "High";
}

export function PositionPill({ position }: { position: number }) {
  if (position === 0) {
    return <span className="text-[13px] text-muted-foreground tabular-nums">—</span>;
  }
  const color =
    position <= 3
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : position <= 10
      ? "bg-[#2a78d6]/[0.08] text-[#1c5cab] border-[#2a78d6]/25"
      : "bg-muted/60 text-foreground/75 border-border";
  return (
    <span className={`inline-flex min-w-[38px] justify-center text-[13px] font-semibold px-1.5 py-0.5 rounded-md border tabular-nums ${color}`}>
      #{position}
    </span>
  );
}

export function DeltaText({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return <span className="text-[13px] text-muted-foreground">—</span>;
  return delta > 0 ? (
    <span className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-emerald-700 tabular-nums">
      <ArrowUp size={11} />{delta}
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-amber-700 tabular-nums">
      <ArrowDown size={11} />{Math.abs(delta)}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-[#001A2E] tabular-nums">{children}</div>
    </div>
  );
}

// Everything known about one tracked keyword, in plain language.
export function KeywordDetail({ kw }: { kw: RankedKeyword }) {
  const ranking = kw.position > 0;
  const otherSite = kw.landingUrl && !kw.landingPath;

  return (
    <div className="space-y-3.5">
      <div>
        <div className="text-[16px] font-semibold text-[#001A2E] leading-snug">{kw.keyword}</div>
        {kw.type && (
          <>
            <span className="mt-1.5 inline-block rounded-md bg-[#001A2E]/[0.06] px-1.5 py-0.5 text-[12px] font-semibold text-[#001A2E]/80">
              {kw.type.label}
            </span>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{kw.type.explanation}</p>
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-3 rounded-xl bg-[#f7fafb] p-3">
        <Stat label="Google rank">{ranking ? `#${kw.position}` : "Not top 100"}</Stat>
        <Stat label="7-day change">
          {ranking && kw.delta ? <DeltaText delta={kw.delta} /> : <span className="text-muted-foreground font-medium">—</span>}
        </Stat>
        <Stat label="Best this month">{kw.bestThisMonth ? `#${kw.bestThisMonth}` : "—"}</Stat>
        <Stat label="Searches / mo">{kw.volume != null ? kw.volume.toLocaleString() : "—"}</Stat>
        <Stat label="Ad competition">{competitionLabel(kw.competition)}</Stat>
        <Stat label="AI Overview">{kw.inAiOverview ? "Cited" : "No"}</Stat>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1">
          Page that ranks
        </div>
        {kw.landingPath ? (
          <div className="text-[14px] font-medium text-foreground/85 break-all">
            {kw.landingPath === "/" ? "Home (/)" : kw.landingPath}
          </div>
        ) : otherSite ? (
          <div className="text-[13px] text-amber-800">
            {kw.landingUrl} <span className="text-muted-foreground">(not the main site)</span>
          </div>
        ) : (
          <div className="text-[13px] text-muted-foreground">
            {ranking ? "SE Ranking didn't report the page." : "No page ranks in the top 100 yet."}
          </div>
        )}
      </div>

      {kw.inAiOverview && (
        <p className="flex items-start gap-1.5 text-[13px] text-foreground/75">
          <Sparkles size={13} className="mt-0.5 shrink-0 text-[#0394B2]" />
          Google&apos;s AI Overview cites this site for this search.
        </p>
      )}
    </div>
  );
}
