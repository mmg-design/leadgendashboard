"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Activity, Calendar, Clock, RefreshCw } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface CommentItem {
  id: string;
  name: string;
  phase: string;
  latestComment: string;
  commentDate: string;
}

interface WorkSummaryData {
  activityFeed: { id: string; name: string; phase: string; completedAt: string }[];
  tasksWithComments: CommentItem[];
  teamMembers: { name: string; email: string; color?: string }[];
  engagementStartDate: string | null;
  timeTrackedThisMonthMs: number;
}

interface WorkSummaryProps {
  clientName: string;
  data: WorkSummaryData | null;
  loading: boolean;
  enabled: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0h";
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function WorkSummary({ clientName, data, loading, enabled, error, onRefresh }: WorkSummaryProps) {
  // Merge activity feed + comments into a single stream, sorted by recency
  const activityStream: { id: string; name: string; phase: string; text?: string; ts: number }[] = [];

  if (data?.activityFeed) {
    for (const item of data.activityFeed) {
      activityStream.push({ id: `done-${item.id}`, name: item.name, phase: item.phase, ts: new Date(item.completedAt).getTime() });
    }
  }
  if (data?.tasksWithComments) {
    for (const item of data.tasksWithComments) {
      activityStream.push({ id: `comment-${item.id}`, name: item.name, phase: item.phase, text: item.latestComment, ts: new Date(item.commentDate).getTime() });
    }
  }
  activityStream.sort((a, b) => b.ts - a.ts);

  return (
    <div className="space-y-4">
      {/* Engagement card — name + date on right */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
              Engagement
            </div>
            <div className="text-right">
              <div className="text-[15px] font-headline font-normal text-[#0B4F6C] leading-tight">
                {clientName}
              </div>
              {data?.engagementStartDate && (
                <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground mt-0.5">
                  <Calendar size={10} />
                  <span>Since {format(new Date(data.engagementStartDate), "MMM d, yyyy")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Time tracked this month */}
          {enabled && (
            <div className="mt-4 pt-3 border-t border-border/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock size={11} />
                  <span>Time tracked this month</span>
                </div>
                <div className="text-[18px] font-light text-[#0B4F6C] tabular-nums">
                  {error ? (
                    <span className="text-[12px] text-red-500">Unavailable</span>
                  ) : loading ? (
                    <span className="text-[12px] text-muted-foreground/40">—</span>
                  ) : (
                    formatDuration(data?.timeTrackedThisMonthMs ?? 0)
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={13} className="text-muted-foreground/60" />
            <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent Activity
            </span>
            <button
              onClick={onRefresh}
              disabled={loading || !onRefresh}
              title="Refresh recent activity"
              className="ml-auto p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-30"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {!enabled ? (
            <p className="text-[12px] text-muted-foreground py-2">
              Connect ClickUp to see recent activity.
            </p>
          ) : error ? (
            <p className="text-[12px] text-red-500 py-2">{error}</p>
          ) : loading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 rounded-md bg-muted/60" />
              ))}
            </div>
          ) : activityStream.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-2">No recent activity.</p>
          ) : (
            <div className="space-y-0">
              {activityStream.map((item) => (
                <div key={item.id} className="py-2.5 border-b border-border/40 last:border-0">
                  <div className="text-[13px] font-medium text-foreground/85 leading-snug mb-1">
                    {item.name}
                  </div>
                  {item.text && (
                    <p className="text-[11px] text-foreground/55 leading-snug line-clamp-2 mb-1">
                      {item.text}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#0B4F6C]/[0.07] text-[#0B4F6C]/70 truncate max-w-[130px]">
                      {item.phase}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50 shrink-0">
                      {formatDistanceToNow(new Date(item.ts), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
