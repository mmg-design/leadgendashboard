"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckSquare, AlertCircle, CheckCircle2 } from "lucide-react";

interface PhaseGroup {
  phase: string;
  count: number;
}

interface ActiveWorkData {
  activeTaskCount: number;
  completedThisMonthCount: number;
  overdueCount: number;
  phaseGroups: PhaseGroup[];
}

interface ActiveWorkProps {
  data: ActiveWorkData | null;
  loading: boolean;
  error: string | null;
  enabled: boolean;
}

export function ActiveWork({ data, loading, error, enabled }: ActiveWorkProps) {
  if (!enabled) {
    return (
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckSquare size={15} className="text-muted-foreground/60" />
            <CardTitle className="text-[22px] font-headline font-normal text-muted-foreground">
              Active Work
            </CardTitle>
            <span className="ml-auto text-[12px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground tracking-wide uppercase">
              Not configured
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-[15px] text-muted-foreground">
            Add ClickUp list IDs in settings to show active tasks.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckSquare size={15} className="text-muted-foreground/60" />
            <CardTitle className="text-[22px] font-headline font-normal text-muted-foreground">
              Active Work
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-7 rounded-lg bg-muted/60" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckSquare size={15} className="text-muted-foreground/60" />
            <CardTitle className="text-[22px] font-headline font-normal text-muted-foreground">
              Active Work
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-[15px] text-red-500">{error || "No data available"}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckSquare size={15} className="text-muted-foreground/60" />
          <CardTitle className="text-[22px] font-headline font-normal text-muted-foreground">
            Active Work
          </CardTitle>
          <span className="text-[13px] text-muted-foreground ml-auto">ClickUp</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/30 px-3 py-3 text-center">
            <div className="text-[24px] font-light text-foreground tabular-nums">
              {data.activeTaskCount}
            </div>
            <div className="text-[13px] text-muted-foreground mt-0.5">Active tasks</div>
          </div>
          <div className="rounded-lg bg-emerald-50 px-3 py-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <CheckCircle2 size={13} className="text-emerald-600" />
              <span className="text-[24px] font-light text-emerald-700 tabular-nums">
                {data.completedThisMonthCount}
              </span>
            </div>
            <div className="text-[13px] text-emerald-600 mt-0.5">Done this month</div>
          </div>
          <div
            className={`rounded-lg px-3 py-3 text-center ${
              data.overdueCount > 0 ? "bg-red-50" : "bg-muted/30"
            }`}
          >
            <div className="flex items-center justify-center gap-1">
              {data.overdueCount > 0 && (
                <AlertCircle size={13} className="text-red-500" />
              )}
              <span
                className={`text-[24px] font-light tabular-nums ${
                  data.overdueCount > 0 ? "text-red-600" : "text-foreground"
                }`}
              >
                {data.overdueCount}
              </span>
            </div>
            <div
              className={`text-[13px] mt-0.5 ${
                data.overdueCount > 0 ? "text-red-500" : "text-muted-foreground"
              }`}
            >
              Overdue
            </div>
          </div>
        </div>

        {/* Tasks by phase */}
        {data.phaseGroups.length > 0 && (
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              By phase
            </div>
            <div className="space-y-1">
              {data.phaseGroups
                .filter((p) => p.count > 0)
                .sort((a, b) => b.count - a.count)
                .map((group) => {
                  const maxCount = Math.max(...data.phaseGroups.map((g) => g.count), 1);
                  const pct = Math.round((group.count / maxCount) * 100);
                  return (
                    <div key={group.phase} className="flex items-center gap-3 py-1">
                      <span className="text-[15px] text-foreground/70 flex-1 truncate">
                        {group.phase}
                      </span>
                      <div className="w-24 h-1.5 rounded-full bg-muted/60 overflow-hidden shrink-0">
                        <div
                          className="h-full rounded-full bg-[#001A2E]/60"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[14px] font-medium text-muted-foreground w-4 text-right shrink-0 tabular-nums">
                        {group.count}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
