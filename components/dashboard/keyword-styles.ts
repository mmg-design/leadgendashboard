// Shared by the Keyword Map's list and canvas views.
import type { Priority, RankBand } from "@/lib/keyword-map";

export const btnSecondary = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[14px] font-medium text-[#001A2E] hover:bg-muted/50 disabled:opacity-50 transition-colors";

// Color shows ranking only; priority is its own tag.
export const BAND: Record<RankBand, { label: string; pill: string; dot: string }> = {
  top3: { label: "1–3", pill: "bg-[#DCFCE7] text-[#166534] border-[#86EFAC]", dot: "bg-[#16A34A]" },
  top10: { label: "4–10", pill: "bg-[#ECFCCB] text-[#3F6212] border-[#BEF264]", dot: "bg-[#65A30D]" },
  top20: { label: "11–20", pill: "bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]", dot: "bg-[#D97706]" },
  top50: { label: "21–50", pill: "bg-[#FFEDD5] text-[#9A3412] border-[#FDBA74]", dot: "bg-[#EA580C]" },
  low: { label: "51–100", pill: "bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]", dot: "bg-[#DC2626]" },
  none: { label: "Not ranking", pill: "bg-[#FEE2E2]/60 text-[#991B1B] border-[#FECACA]", dot: "bg-[#FCA5A5]" },
};

export const PRIORITY_STYLE: Record<Priority, string> = {
  P1: "bg-[#001A2E] text-white",
  P2: "bg-[#0CA4C3]/15 text-[#01384C]",
  P3: "bg-muted text-muted-foreground",
};
