import { LABEL_DEFINITIONS, type PageLabel } from "@/lib/page-behavior";

const STYLES: Record<PageLabel, string> = {
  Strong: "text-emerald-700 bg-emerald-50 border-emerald-200",
  Okay: "text-[#001A2E]/70 bg-[#001A2E]/[0.05] border-[#001A2E]/15",
  Ignored: "text-amber-700 bg-amber-50 border-amber-200",
  Leaking: "text-red-600 bg-red-50 border-red-200",
  "Low data": "text-[#097388]/70 bg-muted/40 border-border",
};

export function PageLabelPill({ label, reason }: { label: PageLabel; reason?: string }) {
  return (
    <span
      className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded border text-[12px] font-semibold ${STYLES[label]}`}
      title={reason ? `${reason}\n\n${label}: ${LABEL_DEFINITIONS[label]}` : LABEL_DEFINITIONS[label]}
    >
      {label}
    </span>
  );
}
