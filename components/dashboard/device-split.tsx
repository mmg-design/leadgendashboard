"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Smartphone } from "lucide-react";
import { deviceInsight, type ClarityDevice, type GaDevice } from "@/lib/page-behavior";

const SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: "desktop", label: "Desktop", color: "bg-[#001A2E]" },
  { key: "mobile", label: "Mobile", color: "bg-[#0CA4C3]" },
  { key: "tablet", label: "Tablet", color: "bg-[#097388]/40" },
];

// Small by design: one share-of-sessions bar from GA4 (so it follows the
// 7d/30d/90d toggle) and at most one sentence comparing mobile to desktop.
export function DeviceSplit({ devices, clarityDevices }: { devices: GaDevice[]; clarityDevices?: ClarityDevice[] }) {
  const total = devices.reduce((sum, d) => sum + d.sessions, 0);
  if (total === 0) return null;

  const shares = SEGMENTS.map((s) => {
    const sessions = devices.find((d) => d.device === s.key)?.sessions || 0;
    return { ...s, sessions, pct: Math.round((sessions / total) * 100) };
  }).filter((s) => s.sessions > 0);
  const insight = deviceInsight(devices, clarityDevices);

  return (
    <Card size="sm">
      <CardContent>
        <div className="flex items-center gap-2 mb-2.5">
          <Smartphone size={14} className="text-[#097388]/75" />
          <span className="text-[18px] font-headline font-normal text-[#001A2E]">Mobile vs desktop</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
          {shares.map((s) => (
            <div key={s.key} className={s.color} style={{ width: `${(s.sessions / total) * 100}%` }} title={`${s.label}: ${s.sessions.toLocaleString()} sessions`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted-foreground">
          {shares.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={`inline-block size-2 rounded-full ${s.color}`} />
              {s.label} <span className="font-medium text-foreground/80 tabular-nums">{s.pct}%</span>
            </span>
          ))}
        </div>
        {insight && <p className="text-[13px] text-foreground/75 mt-2">{insight}</p>}
      </CardContent>
    </Card>
  );
}
