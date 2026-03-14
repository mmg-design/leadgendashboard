"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  TrendingUp,
  Lightbulb,
  CheckCircle2,
  FileText,
  AlertCircle,
} from "lucide-react";

interface AIAnalysis {
  summary: string;
  insights: string[];
  actions: string[];
  topPageAnalysis: string;
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
    <div className="col-span-full rounded-xl overflow-hidden shadow-[0_2px_12px_rgba(11,79,108,0.12)]"
      style={{
        background: "linear-gradient(135deg, #0B4F6C 0%, #0d6180 40%, #11809e 100%)",
      }}
    >
      {/* Header */}
      <div className="px-6 pt-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Sparkles size={16} className="text-white/70" />
          <span className="text-[14px] font-semibold text-white tracking-tight">
            AI Insights
          </span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/15 text-white/70 uppercase tracking-wider">
            Gemini
          </span>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-semibold rounded-lg bg-white text-[#0B4F6C] hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {loading ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles size={12} />
              {analysis ? "Re-analyze" : "Analyze Data"}
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="px-6 pb-6">
        {!analysis && !loading && !error && (
          <div className="text-center py-8">
            <Sparkles size={28} className="mx-auto mb-3 text-white/20" />
            <p className="text-[13px] text-white/50 max-w-md mx-auto leading-relaxed">
              Click &ldquo;Analyze Data&rdquo; to get AI-powered insights about your traffic, lead generation, and actionable next steps.
            </p>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <Loader2 size={28} className="mx-auto mb-3 text-white/60 animate-spin" />
            <p className="text-[13px] text-white/60">
              Analyzing your dashboard data…
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 p-3 bg-red-500/20 rounded-lg border border-red-400/20">
            <AlertCircle size={14} className="text-red-300 mt-0.5 shrink-0" />
            <p className="text-[12px] text-red-200">{error}</p>
          </div>
        )}

        {analysis && !loading && (
          <div className="space-y-5">
            {/* Summary + Lead Score */}
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-[13px] text-white/85 leading-relaxed">
                  {analysis.summary}
                </p>
              </div>
              <div
                className={`shrink-0 px-2.5 py-1 rounded-md border text-[11px] font-semibold uppercase tracking-wider ${scoreConfig[analysis.leadScore]?.color || scoreConfig.medium.color}`}
              >
                {scoreConfig[analysis.leadScore]?.label || "Medium"} Lead Health
              </div>
            </div>

            <div className="h-px bg-white/10" />

            {/* Insights */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <Lightbulb size={13} className="text-amber-300/80" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                  Key Insights
                </span>
              </div>
              <div className="space-y-2">
                {analysis.insights.map((insight, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <TrendingUp size={11} className="text-cyan-300/60 mt-1 shrink-0" />
                    <p className="text-[12px] text-white/75 leading-relaxed">{insight}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Items */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <CheckCircle2 size={13} className="text-emerald-300/80" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                  Action Items
                </span>
              </div>
              <div className="space-y-2">
                {analysis.actions.map((action, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="text-[11px] font-bold text-emerald-300/70 mt-0.5 shrink-0 w-4">
                      {i + 1}.
                    </span>
                    <p className="text-[12px] text-white/75 leading-relaxed">{action}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Page Analysis */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <FileText size={13} className="text-blue-300/80" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                  Page Performance
                </span>
              </div>
              <p className="text-[12px] text-white/75 leading-relaxed">
                {analysis.topPageAnalysis}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
