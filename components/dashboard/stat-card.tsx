"use client";

import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
}

export function StatCard({ title, value, subtitle, icon }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-1">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-medium text-muted-foreground tracking-tight">
            {title}
          </span>
          {icon && (
            <div className="text-[#0B4F6C]/30">{icon}</div>
          )}
        </div>
        <div className="text-[28px] font-semibold tracking-tight leading-none text-[#0B4F6C]">
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
