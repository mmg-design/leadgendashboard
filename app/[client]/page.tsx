"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { StatCard } from "@/components/dashboard/stat-card";
import { getHealth, parseSessionDuration } from "@/lib/health";
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
  Settings,
  Save,
  X,
  Loader2,
  Check,
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

  // Settings panel state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    iconUrl: "",
    gaPropertyId: "",
    clarityProjectId: "",
    snitcherProjectId: "",
    snitcherWorkspaceId: "",
    vectorSiteId: "",
  });

  // Populate settings form when clientConfig loads
  useEffect(() => {
    if (clientConfig) {
      setSettingsForm({
        name: clientConfig.name || "",
        iconUrl: clientConfig.iconUrl || "",
        gaPropertyId: clientConfig.integrations?.googleAnalytics?.propertyId || "",
        clarityProjectId: clientConfig.integrations?.clarity?.projectId || "",
        snitcherProjectId: clientConfig.integrations?.snitcher?.projectId || "",
        snitcherWorkspaceId: clientConfig.integrations?.snitcher?.workspaceId || "",
        vectorSiteId: clientConfig.integrations?.vector?.siteId || "",
      });
    }
  }, [clientConfig]);

  async function handleSaveSettings() {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const integrations: any = {};

      if (settingsForm.gaPropertyId) {
        integrations.googleAnalytics = { enabled: true, propertyId: settingsForm.gaPropertyId };
      } else {
        integrations.googleAnalytics = { enabled: false, propertyId: "" };
      }

      if (settingsForm.clarityProjectId) {
        integrations.clarity = { enabled: true, projectId: settingsForm.clarityProjectId };
      } else {
        integrations.clarity = { enabled: false, projectId: "" };
      }

      if (settingsForm.snitcherProjectId || settingsForm.snitcherWorkspaceId) {
        integrations.snitcher = {
          enabled: true,
          webhookEnabled: true,
          projectId: settingsForm.snitcherProjectId,
          workspaceId: settingsForm.snitcherWorkspaceId,
        };
      } else {
        integrations.snitcher = { enabled: false, webhookEnabled: false, projectId: "", workspaceId: "" };
      }

      if (settingsForm.vectorSiteId) {
        integrations.vector = { enabled: true, webhookEnabled: true, siteId: settingsForm.vectorSiteId };
      } else {
        integrations.vector = { enabled: false, webhookEnabled: false, siteId: "" };
      }

      const res = await fetch("/api/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: clientSlug,
          name: settingsForm.name,
          iconUrl: settingsForm.iconUrl,
          integrations,
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setClientName(settingsForm.name);
        // Refresh client config
        const data = await fetch("/api/clients").then((r) => r.json());
        const match = data.clients?.find((c: any) => c.slug === clientSlug);
        if (match) setClientConfig(match);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  }

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
            {clientConfig?.iconUrl ? (
              <Image
                src={clientConfig.iconUrl}
                alt={`${clientName} icon`}
                width={32}
                height={32}
                className="rounded-lg shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-[#0B4F6C]/8 flex items-center justify-center shrink-0">
                <Building2 size={16} className="text-[#0B4F6C]/40" />
              </div>
            )}
            <h1 className="text-[24px] font-headline font-normal tracking-tight text-[#0B4F6C]">
              {clientName}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Tabs value={range} onValueChange={setRange}>
              <TabsList className="h-8">
                <TabsTrigger value="7d" className="text-xs px-3 h-7">7d</TabsTrigger>
                <TabsTrigger value="30d" className="text-xs px-3 h-7">30d</TabsTrigger>
                <TabsTrigger value="90d" className="text-xs px-3 h-7">90d</TabsTrigger>
              </TabsList>
            </Tabs>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`p-2 rounded-lg transition-colors ${
                settingsOpen
                  ? "bg-[#0B4F6C]/10 text-[#0B4F6C]"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              title="Client Settings"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {settingsOpen && (
        <div className="bg-white border-b border-[#0B4F6C]/[0.08] shadow-sm">
          <div className="max-w-7xl mx-auto px-8 py-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[15px] font-semibold text-[#0B4F6C] tracking-tight">
                Client Settings
              </h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* General */}
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  General
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">Client Name</label>
                  <input
                    type="text"
                    value={settingsForm.name}
                    onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })}
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">Icon URL</label>
                  <input
                    type="text"
                    value={settingsForm.iconUrl}
                    onChange={(e) => setSettingsForm({ ...settingsForm, iconUrl: e.target.value })}
                    placeholder="/clients/slug/icon.png"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">GA4 Property ID</label>
                  <input
                    type="text"
                    value={settingsForm.gaPropertyId}
                    onChange={(e) => setSettingsForm({ ...settingsForm, gaPropertyId: e.target.value })}
                    placeholder="properties/123456789"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
              </div>

              {/* Integrations */}
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Integrations
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">Clarity Project ID</label>
                  <input
                    type="text"
                    value={settingsForm.clarityProjectId}
                    onChange={(e) => setSettingsForm({ ...settingsForm, clarityProjectId: e.target.value })}
                    placeholder="abc123xyz"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">Snitcher Project Hash</label>
                  <input
                    type="text"
                    value={settingsForm.snitcherProjectId}
                    onChange={(e) => setSettingsForm({ ...settingsForm, snitcherProjectId: e.target.value })}
                    placeholder="abc123"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">Snitcher Workspace UUID</label>
                  <input
                    type="text"
                    value={settingsForm.snitcherWorkspaceId}
                    onChange={(e) => setSettingsForm({ ...settingsForm, snitcherWorkspaceId: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">Vector Site ID</label>
                  <input
                    type="text"
                    value={settingsForm.vectorSiteId}
                    onChange={(e) => setSettingsForm({ ...settingsForm, vectorSiteId: e.target.value })}
                    placeholder="site_xxxxx"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
              </div>
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border/50">
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-white bg-[#0B4F6C] rounded-lg hover:bg-[#0B4F6C]/90 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : saveSuccess ? (
                  <Check size={14} />
                ) : (
                  <Save size={14} />
                )}
                {saving ? "Saving..." : saveSuccess ? "Saved!" : "Save Changes"}
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
            health={ga ? getHealth("sessions", ga.summary.sessions, range) : null}
          />
          <StatCard
            title="Pageviews"
            value={ga?.summary.pageviews?.toLocaleString() || "—"}
            subtitle={`Last ${range}`}
            icon={<Eye size={16} />}
            tooltip="Total pages looked at across all visits. If someone clicks through 4 pages in one session, that's 4 pageviews. Higher than sessions means people are exploring."
            health={ga && ga.summary.sessions > 0 ? getHealth("pagesPerSession", ga.summary.pageviews / ga.summary.sessions) : null}
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
            health={visitors?.stats?.unique_companies != null ? getHealth("companiesIdentified", visitors.stats.unique_companies, range) : null}
          />
          <StatCard
            title="Bounce Rate"
            value={ga?.summary.bounceRate || "—"}
            subtitle={ga?.summary.avgSessionDuration ? `Avg ${ga.summary.avgSessionDuration}` : "—"}
            icon={<ArrowDownUp size={16} />}
            tooltip="The % of visitors who left after seeing just one page. Lower is better — it means people are sticking around and clicking through. Under 50% is solid."
            health={ga?.summary.bounceRate ? getHealth("bounceRate", parseFloat(ga.summary.bounceRate)) : null}
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
            clientSlug={clientSlug}
            onSync={() => {
              const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
              fetch(`/api/visitors?client=${clientSlug}&days=${days}`)
                .then((r) => r.json())
                .then(setVisitors)
                .catch(() => {});
            }}
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
                        {process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "")}/api/vector?client={clientSlug}
                      </code>
                    </div>
                  )}
                  {clientConfig.integrations?.snitcher?.enabled && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-muted-foreground w-16 shrink-0">Snitcher</span>
                      <code className="text-[11px] bg-muted/50 px-2 py-1 rounded font-mono text-foreground/70 select-all flex-1 truncate">
                        {process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "")}/api/snitcher?client={clientSlug}
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
