"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface AIAnalysis {
  summary: string;
  actions: string[];
  leadScore: "low" | "medium" | "high";
}

interface AIAnalysisProps {
  clientName: string;
  range: string;
  ga: any;
  visitors: any;
  clarity?: any;
}

const scoreConfig = {
  low: { color: "bg-red-400/20 text-red-200 border-red-400/30", label: "Low" },
  medium: { color: "bg-amber-400/20 text-amber-200 border-amber-400/30", label: "Medium" },
  high: { color: "bg-emerald-400/20 text-emerald-200 border-emerald-400/30", label: "High" },
};

export function AIAnalysisCard({ clientName, range, ga, visitors, clarity }: AIAnalysisProps) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, range, ga, visitors, clarity }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setAnalysis(data.analysis);
      }
    } catch {
      setError("Failed to run analysis");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full rounded-xl overflow-hidden shadow-[0_2px_12px_rgba(11,79,108,0.12)] flex flex-col"
      style={{
        background: "linear-gradient(135deg, #0B4F6C 0%, #0d6180 40%, #11809e 100%)",
      }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-white/70" />
          <span className="text-[17px] font-headline font-normal text-white tracking-tight">
            AI Insights
          </span>
        </div>
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-white/15 text-white/60 uppercase tracking-wider">
          Gemini
        </span>
      </div>

      {/* Content */}
      <div className="px-5 pb-4 flex-1 flex flex-col">
        {!analysis && !loading && !error && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <Sparkles size={22} className="mb-2 text-white/20" />
            <p className="text-[11px] text-white/45 leading-relaxed mb-4 max-w-[180px]">
              Get a quick AI-powered snapshot of your traffic and leads.
            </p>
            <button
              onClick={runAnalysis}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-semibold rounded-lg bg-white text-[#0B4F6C] hover:bg-white/90 transition-all shadow-sm"
            >
              <Sparkles size={11} />
              Analyze Data
            </button>
          </div>
        )}

        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <Loader2 size={22} className="mb-2 text-white/60 animate-spin" />
            <p className="text-[11px] text-white/50">Analyzing…</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-2.5 bg-red-500/20 rounded-lg border border-red-400/20">
            <AlertCircle size={12} className="text-red-300 mt-0.5 shrink-0" />
            <p className="text-[11px] text-red-200">{error}</p>
          </div>
        )}

        {analysis && !loading && (
          <div className="flex-1 flex flex-col gap-3">
            {/* Lead Score */}
            <div
              className={`self-start px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider ${scoreConfig[analysis.leadScore]?.color || scoreConfig.medium.color}`}
            >
              {scoreConfig[analysis.leadScore]?.label || "Medium"} Lead Health
            </div>

            {/* Summary */}
            <p className="text-[11px] text-white/80 leading-relaxed">
              {analysis.summary}
            </p>

            {/* Actions */}
            <div className="space-y-1.5">
              {analysis.actions.map((action, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-[10px] font-bold text-emerald-300/70 mt-0.5 shrink-0">
                    {i + 1}.
                  </span>
                  <p className="text-[10px] text-white/65 leading-relaxed">{action}</p>
                </div>
              ))}
            </div>

            {/* Re-analyze */}
            <button
              onClick={runAnalysis}
              disabled={loading}
              className="mt-auto inline-flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-medium rounded-lg bg-white/15 text-white/80 hover:bg-white/25 transition-all"
            >
              <Sparkles size={10} />
              Re-analyze
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
