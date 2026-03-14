"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StatCard } from "@/components/dashboard/stat-card";
import { TrafficChart } from "@/components/dashboard/traffic-chart";
import { VisitorTable } from "@/components/dashboard/visitor-table";
import { SourceBars } from "@/components/dashboard/source-bars";
import { TopPages } from "@/components/dashboard/top-pages";
import { AIAnalysisCard } from "@/components/dashboard/ai-analysis";
import { ClarityRecordingLink } from "@/components/dashboard/clarity-recording";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  Eye,
  Users,
  Building2,
  ArrowDownUp,
} from "lucide-react";

interface GAData {
  summary: {
    sessions: number;
    pageviews: number;
    uniqueVisitors: number;
    avgSessionDuration: string;
    bounceRate: string;
  };
  dailySessions: { date: string; sessions: number; pageviews: number }[];
  topSources: { source: string; sessions: number }[];
  topPages: { page: string; views: number }[];
}

interface VisitorData {
  visitors: any[];
  stats: {
    unique_companies: number;
    identified_people: number;
    total_visits: number;
    active_sources: number;
  };
}

interface ClarityData {
  topSessionUrl: string;
  pageEngagement: { page: string; engagementScore: number; totalSessions: number }[];
  projectId: string;
}

export default function ClientDashboard() {
  const params = useParams();
  const clientSlug = params.client as string;

  const [range, setRange] = useState("7d");
  const [clientName, setClientName] = useState(
    clientSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
  const [clientConfig, setClientConfig] = useState<any>(null);
  const [ga, setGa] = useState<GAData | null>(null);
  const [visitors, setVisitors] = useState<VisitorData | null>(null);
  const [clarity, setClarity] = useState<ClarityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/clients`)
      .then((r) => r.json())
      .then((data) => {
        const match = data.clients?.find((c: any) => c.slug === clientSlug);
        if (match) {
          setClientName(match.name);
          setClientConfig(match);
        }
      })
      .catch(() => {});

    fetch(`/api/clarity?client=${clientSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setClarity(data);
      })
      .catch(() => {});
  }, [clientSlug]);

  useEffect(() => {
    fetch(`/api/ga?client=${clientSlug}&range=${range}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.details || data.error);
          setGa(null);
        } else {
          setError(null);
          setGa(data);
        }
      })
      .catch(() => setError("Failed to load analytics"));
  }, [clientSlug, range]);

  useEffect(() => {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    fetch(`/api/visitors?client=${clientSlug}&days=${days}`)
      .then((r) => r.json())
      .then(setVisitors)
      .catch(() => {});
  }, [clientSlug, range]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-[#0B4F6C]/[0.06]" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.9) 0%, rgba(228,242,247,0.8) 100%)" }}>
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              &larr; All Clients
            </Link>
            <div className="w-px h-4 bg-border" />
            <h1 className="text-[15px] font-semibold tracking-tight text-[#0B4F6C]">
              {clientName}
            </h1>
          </div>
          <Tabs value={range} onValueChange={setRange}>
            <TabsList className="h-8">
              <TabsTrigger value="7d" className="text-xs px-3 h-7">7d</TabsTrigger>
              <TabsTrigger value="30d" className="text-xs px-3 h-7">30d</TabsTrigger>
              <TabsTrigger value="90d" className="text-xs px-3 h-7">90d</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* Dashboard */}
      <main className="max-w-7xl mx-auto px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg text-[13px] border border-red-100">
            {error}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-5 mb-8">
          <StatCard
            title="Sessions"
            value={ga?.summary.sessions?.toLocaleString() || "—"}
            subtitle={`Last ${range}`}
            icon={<Activity size={16} />}
            tooltip="How many times someone visited the site. If one person comes back 3 times, that's 3 sessions. More sessions = more traffic coming in."
          />
          <StatCard
            title="Pageviews"
            value={ga?.summary.pageviews?.toLocaleString() || "—"}
            subtitle={`Last ${range}`}
            icon={<Eye size={16} />}
            tooltip="Total pages looked at across all visits. If someone clicks through 4 pages in one session, that's 4 pageviews. Higher than sessions means people are exploring."
          />
          <StatCard
            title="Unique Visitors"
            value={ga?.summary.uniqueVisitors?.toLocaleString() || "—"}
            subtitle={`Last ${range}`}
            icon={<Users size={16} />}
            tooltip="How many different people visited. Unlike sessions, repeat visits from the same person only count once. This is your true audience size."
          />
          <StatCard
            title="Companies ID'd"
            value={visitors?.stats?.unique_companies ?? "—"}
            subtitle="Vector + Snitcher"
            icon={<Building2 size={16} />}
            tooltip="Companies we caught visiting the site using IP tracking tools. These are potential leads — real businesses checking you out. Even a few per week is valuable."
          />
          <StatCard
            title="Bounce Rate"
            value={ga?.summary.bounceRate || "—"}
            subtitle={ga?.summary.avgSessionDuration ? `Avg ${ga.summary.avgSessionDuration}` : "—"}
            icon={<ArrowDownUp size={16} />}
            tooltip="The % of visitors who left after seeing just one page. Lower is better — it means people are sticking around and clicking through. Under 50% is solid."
          />
        </div>

        {/* Traffic chart */}
        <div className="mb-8">
          {ga?.dailySessions && <TrafficChart data={ga.dailySessions} />}
        </div>

        {/* Sources + Top Pages */}
        <div className="grid gap-4 md:grid-cols-2 mb-8">
          {ga?.topSources && <SourceBars data={ga.topSources} />}
          {ga?.topPages && <TopPages data={ga.topPages} clarityEngagement={clarity?.pageEngagement} />}
        </div>

        {/* Session Recordings + Identified Visitors + AI Insights */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          {clarity?.topSessionUrl && (
            <ClarityRecordingLink
              topSessionUrl={clarity.topSessionUrl}
              projectId={clarity.projectId}
              pageEngagement={clarity.pageEngagement}
            />
          )}
          <VisitorTable
            visitors={visitors?.visitors || []}
            integrations={clientConfig?.integrations}
          />
          <AIAnalysisCard
            clientName={clientName}
            range={range}
            ga={ga}
            visitors={visitors}
            clarity={clarity}
          />
        </div>

        {/* Webhook URLs */}
        {clientConfig && (clientConfig.integrations?.vector?.enabled || clientConfig.integrations?.snitcher?.enabled) && (
          <div className="mb-8">
            <Card>
              <CardContent className="py-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Webhook URLs
                </div>
                <div className="space-y-2">
                  {clientConfig.integrations?.vector?.enabled && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-muted-foreground w-16 shrink-0">Vector</span>
                      <code className="text-[11px] bg-muted/50 px-2 py-1 rounded font-mono text-foreground/70 select-all flex-1 truncate">
                        {typeof window !== "undefined" ? window.location.origin : ""}/api/vector?client={clientSlug}
                      </code>
                    </div>
                  )}
                  {clientConfig.integrations?.snitcher?.enabled && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-muted-foreground w-16 shrink-0">Snitcher</span>
                      <code className="text-[11px] bg-muted/50 px-2 py-1 rounded font-mono text-foreground/70 select-all flex-1 truncate">
                        {typeof window !== "undefined" ? window.location.origin : ""}/api/snitcher?client={clientSlug}
                      </code>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
