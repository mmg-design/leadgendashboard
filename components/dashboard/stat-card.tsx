"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  tooltip?: string;
  health?: "good" | "warning" | null;
}

const TOOLTIP_WIDTH = 224; // w-56
const EDGE_GAP = 8;

// The tooltip opens to the right of its icon. On a card near the window's right
// edge that would run past the window, and since a hidden (`invisible`) tooltip
// still takes up layout, it would add a horizontal scrollbar even at rest. So it
// opens to the left instead when the right side doesn't fit.
function useTooltipAlign() {
  const ref = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      const fitsRight = r.left + TOOLTIP_WIDTH <= viewport - EDGE_GAP;
      setAlignRight(!fitsRight && r.right - TOOLTIP_WIDTH >= EDGE_GAP);
    };
    place();
    // The grid reflows on resize, and the viewport narrows when a vertical scrollbar appears.
    const ro = new ResizeObserver(place);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);
  return { ref, alignRight };
}

const VALUE_SIZE = 36; // px, the size every value uses when it fits
const MIN_VALUE_SIZE = 16;

// Big numbers (12,345,678 sessions) can be wider than a narrow card. Rather
// than run into the next card, the value scales down until it fits. Values
// that already fit keep the full size, so normal cards look the same.
function useFitValue(value: string | number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    const fit = () => {
      text.style.fontSize = "";
      const natural = text.getBoundingClientRect().width;
      const available = box.clientWidth;
      text.style.fontSize = natural > available
        ? `${Math.max(MIN_VALUE_SIZE, Math.floor((VALUE_SIZE * available * 10) / natural) / 10)}px`
        : "";
    };
    fit();
    // Refit when the card resizes, and once web fonts load (they change the text width).
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [value]);
  return { boxRef, textRef };
}

const healthColors = {
  good: "border-emerald-400",
  warning: "border-amber-400",
};

// `icon` is accepted for existing callers but not drawn: the label already names
// the metric, and the icon was crowding the title on narrow cards.
export function StatCard({ title, value, subtitle, tooltip, health }: StatCardProps) {
  const { ref: tipRef, alignRight } = useTooltipAlign();
  const { boxRef, textRef } = useFitValue(value);
  return (
    <Card className={`h-full min-w-0 overflow-visible relative hover:z-50 ${health ? `border-[2px] ${healthColors[health]}` : ""}`}>
      <CardContent className="h-full flex flex-col">
        {/* Room for a two-line label on every card, so the numbers line up across the row */}
        <div className="flex items-start justify-between gap-2 mb-3 min-w-0 min-h-[30px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em] leading-tight text-muted-foreground">
              {title}
            </span>
            {tooltip && (
              <div ref={tipRef} className="relative group/tip">
                <span className="p-0.5 rounded-md hover:bg-[#001A2E]/[0.06] transition-colors cursor-help inline-flex">
                  <Info size={12} className="text-[#097388]/55 group-hover/tip:text-[#001A2E]/70 transition-colors" />
                </span>
                <div className={`absolute top-full ${alignRight ? "right-0" : "left-0"} mt-2 w-56 px-3 py-2.5 rounded-lg bg-[#001A2E] text-white text-[13px] leading-relaxed shadow-lg opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all duration-200 z-50 pointer-events-none`}>
                  {tooltip}
                  <div className={`absolute bottom-full ${alignRight ? "right-1" : "left-4"} w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[5px] border-b-[#001A2E]`} />
                </div>
              </div>
            )}
          </div>
        </div>
        {/* The div keeps the full-size line height, so a scaled-down value still lines up with its row */}
        <div ref={boxRef} className="text-[36px] font-semibold tracking-[-0.02em] leading-none tabular-nums text-[#001A2E]">
          <span ref={textRef} className="inline-block whitespace-nowrap tracking-[-0.02em]">{value}</span>
        </div>
        {subtitle && (
          <p className="text-[13px] text-muted-foreground mt-auto pt-3">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
