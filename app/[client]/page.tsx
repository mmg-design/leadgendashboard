"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { StatCard } from "@/components/dashboard/stat-card";
import { getHealth } from "@/lib/health";
import { TrafficChart } from "@/components/dashboard/traffic-chart";
import { SourceBars } from "@/components/dashboard/source-bars";
import { TopPages } from "@/components/dashboard/top-pages";
import { AIAnalysisCard } from "@/components/dashboard/ai-analysis";
import { SearchPerformance } from "@/components/dashboard/search-performance";
import { ActiveWork } from "@/components/dashboard/active-work";
import { WorkSummary } from "@/components/dashboard/work-summary";
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
  ImageIcon,
  UploadCloud,
} from "lucide-react";

interface GAData {
  summary: {
    sessions: number;
    sessionsChange?: number | null;
    pageviews: number;
    uniqueVisitors: number;
    avgSessionDuration: string;
    bounceRate: string;
    engagementRate?: string;
  };
  dailySessions: { date: string; sessions: number; pageviews: number }[];
  topSources: { source: string; sessions: number }[];
  topPages: { page: string; views: number; engagementScore?: number; avgDuration?: number }[];
}

interface ClarityData {
  topSessionUrl: string;
  pageEngagement: { page: string; engagementScore: number; totalSessions: number; scrollDepth?: number }[];
  projectId: string;
  rageClicks?: number;
  deadClicks?: number;
  homepageScrollDepth?: number | null;
}

interface SERankingData {
  totalKeywords: number;
  movedUp: number;
  movedDown: number;
  top5: { id: string; keyword: string; position: number; delta: number | null }[];
  currentVisibility: number | null;
  visibilityHistory: { date: string; score: number }[];
}

interface ClickUpData {
  activeTaskCount: number;
  completedThisMonthCount: number;
  overdueCount: number;
  phaseGroups: { phase: string; count: number }[];
  activityFeed: { id: string; name: string; phase: string; completedAt: string }[];
  tasksWithComments: {
    id: string;
    name: string;
    phase: string;
    latestComment: string;
    commentDate: string;
  }[];
  teamMembers: { name: string; email: string; color?: string }[];
  engagementStartDate: string | null;
}

interface ClientConfig {
  name: string;
  slug: string;
  domain: string;
  iconUrl?: string;
  integrations: {
    googleAnalytics?: {
      enabled: boolean;
      propertyId: string;
    };
    clarity?: {
      enabled: boolean;
      projectId: string;
    };
    seRanking?: {
      enabled: boolean;
      projectId: string;
    };
    clickup?: {
      enabled: boolean;
      listIds: string[];
      engagementStartDate?: string;
    };
  };
}

type SettingsIntegrations = {
  googleAnalytics: { enabled: boolean; propertyId: string };
  clarity: { enabled: boolean; projectId: string };
  seRanking: { enabled: boolean; projectId: string };
  clickup: { enabled: boolean; listIds: string[]; engagementStartDate?: string };
};

type ClientsResponse = {
  clients?: ClientConfig[];
};

const MAX_ICON_BYTES = 15 * 1024 * 1024;
const ICON_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg"];

function isSupportedIconFile(file: File) {
  if (file.type.startsWith("image/")) return true;

  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? ICON_FILE_EXTENSIONS.includes(extension) : false;
}

export default function ClientDashboard() {
  const params = useParams();
  const clientSlug = params.client as string;

  const [range, setRange] = useState("7d");
  const [clientName, setClientName] = useState(
    clientSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
  const [clientConfig, setClientConfig] = useState<ClientConfig | null>(null);
  const [ga, setGa] = useState<GAData | null>(null);
  const [clarity, setClarity] = useState<ClarityData | null>(null);
  const [seRanking, setSeRanking] = useState<SERankingData | null>(null);
  const [seRankingLoading, setSeRankingLoading] = useState(false);
  const [seRankingError, setSeRankingError] = useState<string | null>(null);
  const [clickUp, setClickUp] = useState<ClickUpData | null>(null);
  const [clickUpLoading, setClickUpLoading] = useState(false);
  const [clickUpError, setClickUpError] = useState<string | null>(null);
  const [gaError, setGaError] = useState<string | null>(null);

  // Settings panel state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconUploadError, setIconUploadError] = useState<string | null>(null);
  const [iconDragging, setIconDragging] = useState(false);
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    iconUrl: "",
    gaPropertyId: "",
    clarityProjectId: "",
    seRankingProjectId: "",
    clickupListIds: "",
    clickupEngagementStart: "",
  });

  async function readUploadResponse(res: Response) {
    const text = await res.text();
    if (!text) return {};

    try {
      return JSON.parse(text) as { iconUrl?: string; error?: string };
    } catch {
      return { error: text.slice(0, 160) };
    }
  }

  useEffect(() => {
    if (clientConfig) {
      setSettingsForm({
        name: clientConfig.name || "",
        iconUrl: clientConfig.iconUrl || "",
        gaPropertyId: clientConfig.integrations?.googleAnalytics?.propertyId || "",
        clarityProjectId: clientConfig.integrations?.clarity?.projectId || "",
        seRankingProjectId: clientConfig.integrations?.seRanking?.projectId || "",
        clickupListIds: (clientConfig.integrations?.clickup?.listIds || []).join(", "),
        clickupEngagementStart: clientConfig.integrations?.clickup?.engagementStartDate || "",
      });
    }
  }, [clientConfig]);

  async function uploadIcon(file: File | undefined) {
    if (!file) return;

    if (!isSupportedIconFile(file)) {
      setIconUploadError("Use a PNG, JPG, WebP, GIF, or SVG image.");
      return;
    }

    if (file.size > MAX_ICON_BYTES) {
      setIconUploadError("Icon must be 15MB or smaller.");
      return;
    }

    setIconUploading(true);
    setIconUploadError(null);

    try {
      const formData = new FormData();
      formData.append("slug", clientSlug);
      formData.append("icon", file);

      const res = await fetch("/api/clients/icon", {
        method: "POST",
        body: formData,
      });
      const data = await readUploadResponse(res);

      if (!res.ok || !data.iconUrl) {
        throw new Error(data.error || `Upload failed with status ${res.status}`);
      }

      const iconUrl = data.iconUrl;
      setSettingsForm((current) => ({ ...current, iconUrl }));
      setClientConfig((current) => current ? { ...current, iconUrl } : current);
    } catch (err) {
      setIconUploadError(err instanceof Error ? err.message : "Failed to upload icon");
    } finally {
      setIconUploading(false);
      if (iconInputRef.current) iconInputRef.current.value = "";
    }
  }

  function handleIconInputChange(e: ChangeEvent<HTMLInputElement>) {
    uploadIcon(e.target.files?.[0]);
  }

  function handleIconDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIconDragging(false);
    uploadIcon(e.dataTransfer.files?.[0]);
  }

  async function handleSaveSettings() {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const clickupListIds = settingsForm.clickupListIds
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const integrations: SettingsIntegrations = {
        googleAnalytics: settingsForm.gaPropertyId
          ? { enabled: true, propertyId: settingsForm.gaPropertyId }
          : { enabled: false, propertyId: "" },
        clarity: settingsForm.clarityProjectId
          ? { enabled: true, projectId: settingsForm.clarityProjectId }
          : { enabled: false, projectId: "" },
        seRanking: settingsForm.seRankingProjectId
          ? { enabled: true, projectId: settingsForm.seRankingProjectId }
          : { enabled: false, projectId: "" },
        clickup:
          clickupListIds.length > 0
            ? {
                enabled: true,
                listIds: clickupListIds,
                engagementStartDate: settingsForm.clickupEngagementStart || undefined,
              }
            : { enabled: false, listIds: [] },
      };

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
        const data = await fetch("/api/clients").then((r) => r.json()) as ClientsResponse;
        const match = data.clients?.find((c) => c.slug === clientSlug);
        if (match) setClientConfig(match);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  }

  // Load client config + clarity
  useEffect(() => {
    fetch(`/api/clients`)
      .then((r) => r.json())
      .then((data: ClientsResponse) => {
        const match = data.clients?.find((c) => c.slug === clientSlug);
        if (match) {
          setClientName(match.name);
          setClientConfig(match);
        }
      })
      .catch(() => {});

    fetch(`/api/clarity?client=${clientSlug}`)
      .then((r) => r.json())
      .then((data) => { if (!data.error) setClarity(data); })
      .catch(() => {});
  }, [clientSlug]);

  // Load SE Ranking (only when enabled)
  useEffect(() => {
    if (!clientConfig?.integrations?.seRanking?.enabled) return;
    setSeRankingLoading(true);
    setSeRankingError(null);
    fetch(`/api/seranking?client=${clientSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setSeRankingError(data.error);
        else setSeRanking(data);
      })
      .catch(() => setSeRankingError("Failed to load SE Ranking data"))
      .finally(() => setSeRankingLoading(false));
  }, [clientSlug, clientConfig]);

  // Load ClickUp (only when enabled)
  useEffect(() => {
    if (!clientConfig?.integrations?.clickup?.enabled) return;
    setClickUpLoading(true);
    setClickUpError(null);
    fetch(`/api/clickup?client=${clientSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setClickUpError(data.error);
        else setClickUp(data);
      })
      .catch(() => setClickUpError("Failed to load ClickUp data"))
      .finally(() => setClickUpLoading(false));
  }, [clientSlug, clientConfig]);

  // Load GA4
  useEffect(() => {
    fetch(`/api/ga?client=${clientSlug}&range=${range}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setGaError(data.details || data.error);
          setGa(null);
        } else {
          setGaError(null);
          setGa(data);
        }
      })
      .catch(() => setGaError("Failed to load analytics"));
  }, [clientSlug, range]);

  const seRankingEnabled = !!clientConfig?.integrations?.seRanking?.enabled;
  const clickupEnabled = !!clientConfig?.integrations?.clickup?.enabled;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header
        className="bg-white/80 backdrop-blur-md border-b border-[#0B4F6C]/[0.06]"
        style={{
          background:
            "linear-gradient(90deg, rgba(255,255,255,0.9) 0%, rgba(228,242,247,0.8) 100%)",
        }}
      >
        <div className="max-w-[1400px] mx-auto px-8 py-4 flex items-center justify-between">
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
                unoptimized={clientConfig.iconUrl.startsWith("data:")}
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
          <div className="max-w-[1400px] mx-auto px-8 py-6">
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

            <div className="grid gap-6 md:grid-cols-3">
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
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">Project Icon</label>
                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIconDragging(true);
                    }}
                    onDragLeave={() => setIconDragging(false)}
                    onDrop={handleIconDrop}
                    className={`relative flex size-24 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed bg-background transition-colors ${
                      iconDragging
                        ? "border-[#0B4F6C] bg-[#0B4F6C]/5"
                        : "border-border hover:border-[#0B4F6C]/40 hover:bg-[#0B4F6C]/[0.03]"
                    }`}
                    title="Upload project icon"
                  >
                    <input
                      ref={iconInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                      className="sr-only"
                      onChange={handleIconInputChange}
                    />
                    {settingsForm.iconUrl ? (
                      <Image
                        src={settingsForm.iconUrl}
                        alt={`${settingsForm.name || clientName} icon preview`}
                        fill
                        sizes="96px"
                        unoptimized={settingsForm.iconUrl.startsWith("data:")}
                        className="object-contain p-3"
                      />
                    ) : (
                      <ImageIcon size={24} className="text-[#0B4F6C]/35" />
                    )}
                    <span className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-white/90 text-[#0B4F6C] shadow-[0_-1px_0_rgba(11,79,108,0.08)]">
                      {iconUploading ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <UploadCloud size={13} />
                      )}
                    </span>
                  </label>
                  {iconUploadError && (
                    <p className="mt-1 text-[10px] text-red-600">{iconUploadError}</p>
                  )}
                </div>
              </div>

              {/* Analytics */}
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Analytics
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
              </div>

              {/* SEO & Project Work */}
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  SEO &amp; Project Work
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">SE Ranking Project ID</label>
                  <input
                    type="text"
                    value={settingsForm.seRankingProjectId}
                    onChange={(e) => setSettingsForm({ ...settingsForm, seRankingProjectId: e.target.value })}
                    placeholder="123456"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">From the SE Ranking project URL</p>
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">ClickUp List IDs</label>
                  <input
                    type="text"
                    value={settingsForm.clickupListIds}
                    onChange={(e) => setSettingsForm({ ...settingsForm, clickupListIds: e.target.value })}
                    placeholder="901234567, 901234568"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">Comma-separated, from ClickUp list URLs</p>
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground/70 mb-1 block">Engagement Start Date</label>
                  <input
                    type="date"
                    value={settingsForm.clickupEngagementStart}
                    onChange={(e) => setSettingsForm({ ...settingsForm, clickupEngagementStart: e.target.value })}
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
              </div>
            </div>

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
      <main className="max-w-[1400px] mx-auto px-8 py-8">
        {gaError && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg text-[13px] border border-red-100">
            {gaError}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
          {/* ── Left column ── */}
          <div className="min-w-0 space-y-6">
            {/* Search Performance */}
            <SearchPerformance
              data={seRanking}
              loading={seRankingLoading}
              error={seRankingError}
              enabled={seRankingEnabled}
            />

            {/* Website Performance */}
            <div className="space-y-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Website Performance
              </div>

              {/* Stat cards */}
              <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                <StatCard
                  title="Sessions"
                  value={ga?.summary.sessions?.toLocaleString() || "—"}
                  subtitle={`Last ${range}`}
                  icon={<Activity size={16} />}
                  tooltip="How many times someone visited the site. If one person comes back 3 times, that's 3 sessions."
                  health={ga ? getHealth("sessions", ga.summary.sessions, range) : null}
                />
                <StatCard
                  title="Pageviews"
                  value={ga?.summary.pageviews?.toLocaleString() || "—"}
                  subtitle={`Last ${range}`}
                  icon={<Eye size={16} />}
                  tooltip="Total pages looked at across all visits. Higher than sessions means people are exploring."
                  health={
                    ga && ga.summary.sessions > 0
                      ? getHealth("pagesPerSession", ga.summary.pageviews / ga.summary.sessions)
                      : null
                  }
                />
                <StatCard
                  title="Unique Visitors"
                  value={ga?.summary.uniqueVisitors?.toLocaleString() || "—"}
                  subtitle={`Last ${range}`}
                  icon={<Users size={16} />}
                  tooltip="How many different people visited. Repeat visits from the same person only count once."
                />
                <StatCard
                  title="Engagement Rate"
                  value={ga?.summary.engagementRate || ga?.summary.bounceRate || "—"}
                  subtitle={ga?.summary.avgSessionDuration ? `Avg ${ga.summary.avgSessionDuration}` : "—"}
                  icon={<ArrowDownUp size={16} />}
                  tooltip="% of sessions where the user actively engaged — scrolled, clicked, or stayed 10+ seconds. GA4's replacement for bounce rate. 60%+ is healthy."
                />
              </div>

              {/* Traffic chart */}
              {ga?.dailySessions && <TrafficChart data={ga.dailySessions} />}

              {/* Sources + Top Pages */}
              {(ga?.topSources || ga?.topPages) && (
                <div className="grid gap-4 md:grid-cols-2">
                  {ga?.topSources && <SourceBars data={ga.topSources} />}
                  {ga?.topPages && <TopPages data={ga.topPages} />}
                </div>
              )}

              {/* AI Insights */}
              <AIAnalysisCard
                clientName={clientName}
                range={range}
                ga={ga}
                clarity={clarity}
                seRanking={seRanking}
                clickUp={clickUp}
              />
            </div>

            {/* Active Work */}
            <ActiveWork
              data={clickUp}
              loading={clickUpLoading}
              error={clickUpError}
              enabled={clickupEnabled}
            />
          </div>

          {/* ── Right column ── */}
          <div className="xl:sticky xl:top-8">
            <WorkSummary
              clientName={clientName}
              data={clickUp}
              loading={clickUpLoading}
              enabled={clickupEnabled}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
