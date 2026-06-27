"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Users, MessageSquare, CheckCircle2, Calendar } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

interface ActivityItem {
  id: string;
  name: string;
  phase: string;
  completedAt: string;
}

interface CommentItem {
  id: string;
  name: string;
  phase: string;
  latestComment: string;
  commentDate: string;
}

interface TeamMember {
  name: string;
  email: string;
  color?: string;
}

interface WorkSummaryData {
  activityFeed: ActivityItem[];
  tasksWithComments: CommentItem[];
  teamMembers: TeamMember[];
  engagementStartDate: string | null;
}

interface WorkSummaryProps {
  clientName: string;
  data: WorkSummaryData | null;
  loading: boolean;
  enabled: boolean;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function Avatar({ name, color }: { name: string; color?: string }) {
  const bg = color || "#0B4F6C";
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
      style={{ backgroundColor: bg }}
    >
      {initials(name)}
    </div>
  );
}

export function WorkSummary({ clientName, data, loading, enabled }: WorkSummaryProps) {
  return (
    <div className="space-y-4">
      {/* Client header card */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Engagement
          </div>
          <div className="text-[20px] font-headline font-normal text-[#0B4F6C] leading-tight mb-2">
            {clientName}
          </div>
          {data?.engagementStartDate && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Calendar size={12} />
              <span>
                Since{" "}
                {format(new Date(data.engagementStartDate), "MMMM d, yyyy")}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity feed */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={13} className="text-muted-foreground/60" />
            <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recently completed
            </span>
          </div>

          {!enabled ? (
            <p className="text-[12px] text-muted-foreground py-2">
              Connect ClickUp to see completed tasks.
            </p>
          ) : loading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 rounded-md bg-muted/60" />
              ))}
            </div>
          ) : !data || data.activityFeed.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-2">No tasks completed in the last 30 days.</p>
          ) : (
            <div className="space-y-0.5">
              {data.activityFeed.map((item) => (
                <div
                  key={item.id}
                  className="py-2 border-b border-border/40 last:border-0"
                >
                  <div className="text-[12px] text-foreground/80 leading-snug">{item.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#0B4F6C]/[0.07] text-[#0B4F6C]/70 truncate max-w-[120px]">
                      {item.phase}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {formatDistanceToNow(new Date(item.completedAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent comments */}
      {enabled && data && data.tasksWithComments.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={13} className="text-muted-foreground/60" />
              <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                Recent comments
              </span>
            </div>
            <div className="space-y-3">
              {data.tasksWithComments.map((item) => (
                <div key={item.id} className="border-b border-border/40 last:border-0 pb-3 last:pb-0">
                  <div className="text-[11px] font-medium text-[#0B4F6C]/80 mb-1 truncate">
                    {item.name}
                  </div>
                  <p className="text-[12px] text-foreground/70 leading-snug line-clamp-2">
                    {item.latestComment}
                  </p>
                  <div className="text-[10px] text-muted-foreground/50 mt-1">
                    {formatDistanceToNow(new Date(item.commentDate), { addSuffix: true })}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team block */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center gap-2 mb-3">
            <Users size={13} className="text-muted-foreground/60" />
            <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your MMG team
            </span>
          </div>

          {!enabled || !data || data.teamMembers.length === 0 ? (
            <div className="space-y-2">
              {[
                { name: "Andy Milligan", role: "Strategy & Accounts" },
              ].map((m) => (
                <div key={m.name} className="flex items-center gap-2.5">
                  <Avatar name={m.name} />
                  <div>
                    <div className="text-[12px] font-medium text-foreground/80">{m.name}</div>
                    <div className="text-[11px] text-muted-foreground">{m.role}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.teamMembers.map((member, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <Avatar name={member.name} color={member.color} />
                  <div>
                    <div className="text-[12px] font-medium text-foreground/80">{member.name}</div>
                    {member.email && (
                      <div className="text-[11px] text-muted-foreground">{member.email}</div>
                    )}
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
