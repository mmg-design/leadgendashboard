"use client";

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

const healthColors = {
  good: "border-emerald-400",
  warning: "border-amber-400",
};

export function StatCard({ title, value, subtitle, icon, tooltip, health }: StatCardProps) {
  return (
    <Card className={`overflow-visible relative hover:z-50 ${health ? `border-[2px] ${healthColors[health]}` : ""}`}>
      <CardContent className="pt-1">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-muted-foreground tracking-tight">
              {title}
            </span>
            {tooltip && (
              <div className="relative group/tip">
                <span className="p-0.5 rounded-md hover:bg-[#001A2E]/[0.06] transition-colors cursor-help inline-flex">
                  <Info size={12} className="text-muted-foreground/40 group-hover/tip:text-[#001A2E]/70 transition-colors" />
                </span>
                <div className="absolute top-full left-0 mt-2 w-56 px-3 py-2.5 rounded-lg bg-[#001A2E] text-white text-[11px] leading-relaxed shadow-lg opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all duration-200 z-50 pointer-events-none">
                  {tooltip}
                  <div className="absolute bottom-full left-4 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[5px] border-b-[#001A2E]" />
                </div>
              </div>
            )}
          </div>
          {icon && (
            <div className="text-[#001A2E]/30">{icon}</div>
          )}
        </div>
        <div className="text-[36px] font-headline font-normal tracking-tight leading-none text-[#001A2E]">
          {value}
        </div>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground mt-2 tracking-wide uppercase">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
