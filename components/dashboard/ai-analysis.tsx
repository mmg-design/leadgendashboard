"use client";

import { useState } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";

interface AIAnalysis {
  summary: string;
  actions: string[];
  leadScore: "low" | "medium" | "high";
}

interface AIAnalysisProps {
  clientName: string;
  range: string;
  ga: any;
  visitors?: any;
  clarity?: any;
  seRanking?: any;
  clickUp?: any;
}

const scoreConfig = {
  low: { color: "bg-red-400/20 text-red-200 border-red-400/30", label: "Low" },
  medium: { color: "bg-amber-400/20 text-amber-200 border-amber-400/30", label: "Medium" },
  high: { color: "bg-emerald-400/20 text-emerald-200 border-emerald-400/30", label: "High" },
};

export function AIAnalysisCard({ clientName, range, ga, visitors, clarity, seRanking, clickUp }: AIAnalysisProps) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedSources = [
    ga && "GA4",
    clarity && "Clarity",
    seRanking && "SE Ranking",
    clickUp && "ClickUp",
  ].filter(Boolean);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, range, ga, visitors, clarity, seRanking, clickUp }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setAnalysis(data.analysis);
    } catch {
      setError("Failed to run analysis");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="h-full rounded-xl overflow-hidden shadow-[0_2px_12px_rgba(0,26,46,0.12)] flex flex-col"
      style={{ background: "linear-gradient(135deg, #001A2E 0%, #01384C 52%, #072732 100%)" }}
    >
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-white/70" />
          <span className="text-[22px] font-headline font-normal text-white tracking-tight">AI Insights</span>
        </div>
        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-white/15 text-white/60 uppercase tracking-wider">
          Gemini
        </span>
      </div>

      <div className="px-5 pb-4 flex-1 flex flex-col">
        {!analysis && !loading && !error && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <Sparkles size={22} className="mb-2 text-white/20" />
            {connectedSources.length > 0 ? (
              <p className="text-[13px] text-white/45 leading-relaxed mb-1 max-w-[200px]">
                Analyze all connected data:
              </p>
            ) : null}
            {connectedSources.length > 0 && (
              <p className="text-[12px] text-white/30 mb-4">
                {connectedSources.join(" · ")}
              </p>
            )}
            {connectedSources.length === 0 && (
              <p className="text-[13px] text-white/45 leading-relaxed mb-4 max-w-[180px]">
                Connect integrations to get AI-powered insights across all your data.
              </p>
            )}
            <button
              onClick={runAnalysis}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[14px] font-semibold rounded-lg bg-[#0CA4C3] text-white hover:bg-[#0394B2] transition-all shadow-[0_0_0_1px_#0e91ac,0_-1px_1px_rgba(7,39,50,.67),inset_0_1px_1px_rgba(255,255,255,.22),inset_0_4px_12px_rgba(255,255,255,.3),0_4px_10px_rgba(27,121,140,.14)]"
            >
              <Sparkles size={11} />
              Analyze Data
            </button>
          </div>
        )}

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <Loader2 size={22} className="mb-2 text-white/60 animate-spin" />
            <p className="text-[13px] text-white/50">Analyzing {connectedSources.join(", ")}…</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-2.5 bg-red-500/20 rounded-lg border border-red-400/20">
            <AlertCircle size={12} className="text-red-300 mt-0.5 shrink-0" />
            <p className="text-[13px] text-red-200">{error}</p>
          </div>
        )}

        {analysis && !loading && (
          <div className="flex-1 flex flex-col gap-3">
            <div
              className={`self-start px-2 py-0.5 rounded-md border text-[12px] font-semibold uppercase tracking-wider ${scoreConfig[analysis.leadScore]?.color || scoreConfig.medium.color}`}
            >
              {scoreConfig[analysis.leadScore]?.label || "Medium"} Performance
            </div>

            <p className="text-[13px] text-white/80 leading-relaxed">{analysis.summary}</p>

            <div className="space-y-1.5">
              {analysis.actions.map((action, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[12px] font-bold text-emerald-300/70 mt-0.5 shrink-0">{i + 1}.</span>
                  <p className="text-[12px] text-white/65 leading-relaxed">{action}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1.5 mt-auto pt-2 border-t border-white/10">
              <p className="text-[11px] text-white/30 flex-1">
                Based on: {connectedSources.join(", ")}
              </p>
              <button
                onClick={runAnalysis}
                disabled={loading}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-md bg-white/15 text-white/70 hover:bg-white/25 transition-all"
              >
                <Sparkles size={9} />
                Re-analyze
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
