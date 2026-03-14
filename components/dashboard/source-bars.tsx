"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe } from "lucide-react";

interface SourceBarsProps {
  data: { source: string; sessions: number }[];
  title?: string;
}

export function SourceBars({ data, title = "Traffic Sources" }: SourceBarsProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe size={15} className="text-muted-foreground/60" />
          <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <XAxis
                type="number"
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                axisLine={{ stroke: "rgba(0,0,0,0.06)" }}
                tickLine={false}
              />
              <YAxis
                dataKey="source"
                type="category"
                width={100}
                tick={{ fill: "#6b7280", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid rgba(0,0,0,0.06)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  padding: "8px 12px",
                }}
              />
              <Bar dataKey="sessions" fill="#0B4F6C" radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
