"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

interface TrafficChartProps {
  data: { date: string; sessions: number; pageviews: number }[];
  title?: string;
}

export function TrafficChart({ data, title = "Traffic Overview" }: TrafficChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  return (
    <Card className="col-span-full">
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp size={15} className="text-muted-foreground/60" />
          <CardTitle className="text-[17px] font-headline font-normal text-muted-foreground">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formatted}>
              <defs>
                <linearGradient id="sessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#001A2E" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#001A2E" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="pageviews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0394B2" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#0394B2" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                axisLine={{ stroke: "rgba(0,0,0,0.06)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#9ca3af", fontSize: 11 }}
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
              <Area
                type="monotone"
                dataKey="sessions"
                stroke="#001A2E"
                fillOpacity={1}
                fill="url(#sessions)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="pageviews"
                stroke="#0394B2"
                fillOpacity={1}
                fill="url(#pageviews)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
