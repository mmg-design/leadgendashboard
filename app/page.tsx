"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Radar,
  Plus,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Eye,
  Search,
  Video,
  Loader2,
  Check,
  Globe,
  Building2,
  Info,
} from "lucide-react";

interface ClientConfig {
  name: string;
  slug: string;
  domain: string;
  integrations: Record<string, { enabled: boolean; [key: string]: any }>;
}

const integrationMeta = [
  {
    key: "googleAnalytics",
    label: "Google Analytics 4",
    icon: BarChart3,
    badge: "GA4",
    tooltip: "This pulls traffic data — sessions, pageviews, top pages, etc. Open analytics.google.com, click the gear icon (Admin), then Property Settings. The Property ID is the number at the top (like 430286560). Ask Andy if you need help with service account access.",
    fields: [
      { name: "propertyId", label: "Property ID", placeholder: "e.g. 430286560", hint: "The number from GA4 → Admin → Property Settings" },
    ],
  },
  {
    key: "vector",
    label: "Vector.co",
    icon: Eye,
    badge: "Vector",
    tooltip: "Vector identifies who's visiting the site by name and email (US visitors only). It sends data to us automatically via webhook. After you create this client, go to the client dashboard — you'll see a webhook URL at the bottom. Copy that URL and paste it in Vector → Integrations → Webhook.",
    fields: [
      { name: "siteId", label: "Site ID (optional)", placeholder: "From the Vector URL, like: app.vector.co/sites/abc123", hint: "Optional — leave blank if you're not sure" },
    ],
  },
  {
    key: "snitcher",
    label: "Snitcher",
    icon: Search,
    badge: "Snitcher",
    tooltip: "Snitcher identifies which companies are visiting the site. We pull data directly from Snitcher's API, so you need the Workspace ID. Open app.snitcher.com — the Workspace ID is the code in the URL right after snitcher.com/ (looks like V9Gl4nA5). The full UUID is fetched automatically.",
    fields: [
      { name: "workspaceId", label: "Workspace UUID", placeholder: "e.g. 0fdba883-26fa-4464-b101-fc05b445fa1e", hint: "Go to Snitcher → Settings → API → copy your Workspace UUID" },
      { name: "projectId", label: "Project Hash (optional)", placeholder: "e.g. V9Gl4nA5", hint: "The short code in the URL: app.snitcher.com/{this-part}/dashboard" },
    ],
  },
  {
    key: "clarity",
    label: "Microsoft Clarity",
    icon: Video,
    badge: "Clarity",
    tooltip: "Clarity shows which pages people engage with most — scroll depth, time spent, clicks. Open clarity.microsoft.com, pick the project, and the Project ID is the short code in the URL (like vsqtrrcn93).",
    fields: [
      { name: "projectId", label: "Project ID", placeholder: "e.g. vsqtrrcn93", hint: "The code in the URL: clarity.microsoft.com/projects/view/{this-part}" },
    ],
  },
];

export default function Home() {
  const [clients, setClients] = useState<ClientConfig[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [integrations, setIntegrations] = useState<Record<string, { enabled: boolean; [key: string]: any }>>({
    googleAnalytics: { enabled: false, propertyId: "" },
    vector: { enabled: false, siteId: "" },
    snitcher: { enabled: false, projectId: "", workspaceId: "" },
    clarity: { enabled: false, projectId: "" },
  });

  const fetchClients = () => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data) => setClients(data.clients || []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const toggleIntegration = (key: string) => {
    setIntegrations((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }));
  };

  const setField = (integrationKey: string, fieldName: string, value: string) => {
    setIntegrations((prev) => ({
      ...prev,
      [integrationKey]: { ...prev[integrationKey], [fieldName]: value },
    }));
  };

  const resetForm = () => {
    setName("");
    setDomain("");
    setIntegrations({
      googleAnalytics: { enabled: false, propertyId: "" },
      vector: { enabled: false, siteId: "" },
      snitcher: { enabled: false, projectId: "", workspaceId: "" },
      clarity: { enabled: false, projectId: "" },
    });
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain, integrations }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create client");
      } else {
        setSuccess(true);
        resetForm();
        fetchClients();
        setTimeout(() => {
          setSuccess(false);
          setFormOpen(false);
        }, 1500);
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto py-20 px-8">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <Radar size={20} className="text-[#0B4F6C]" />
            <h1 className="text-[22px] font-semibold tracking-tight text-[#0B4F6C]">
              Lead Gen Dashboard
            </h1>
          </div>
          <p className="text-[14px] text-muted-foreground">
            Manage clients and view their website visibility and lead data.
          </p>
        </div>

        {/* Add Client Card */}
        <div className="mb-8">
          <Card className="overflow-hidden border-dashed border-[#0B4F6C]/15 hover:border-[#0B4F6C]/25 transition-colors">
            {/* Toggle header */}
            <button
              onClick={() => { setFormOpen(!formOpen); if (success) setSuccess(false); }}
              className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-[#0B4F6C]/[0.02] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#0B4F6C]/8 flex items-center justify-center">
                  <Plus size={16} className="text-[#0B4F6C]" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-[#0B4F6C]">
                    Add New Client
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    Configure integrations and start tracking
                  </div>
                </div>
              </div>
              {formOpen ? (
                <ChevronUp size={16} className="text-muted-foreground" />
              ) : (
                <ChevronDown size={16} className="text-muted-foreground" />
              )}
            </button>

            {/* Form */}
            {formOpen && (
              <form onSubmit={handleSubmit}>
                <div className="px-6 pb-6 border-t border-border/50">
                  <div className="pt-5 space-y-5">
                    {/* Client info */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Client Name
                        </label>
                        <div className="relative">
                          <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. MMG Design Studio"
                            required
                            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-border bg-white/60 focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30 transition-all placeholder:text-muted-foreground/40"
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground/50 mt-1">The client&apos;s business name — this shows up as the dashboard title</p>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Domain
                        </label>
                        <div className="relative">
                          <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                          <input
                            type="text"
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            placeholder="e.g. mmg.studio"
                            required
                            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg border border-border bg-white/60 focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30 transition-all placeholder:text-muted-foreground/40"
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground/50 mt-1">Their website URL without https:// — just the domain like &quot;mmg.studio&quot;</p>
                      </div>
                    </div>

                    {/* Integrations */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                        Integrations
                      </label>
                      <div className="grid gap-2.5 md:grid-cols-2">
                        {integrationMeta.map((int) => {
                          const Icon = int.icon;
                          const enabled = integrations[int.key]?.enabled;
                          return (
                            <div
                              key={int.key}
                              className={`rounded-lg border p-3 transition-all ${
                                enabled
                                  ? "border-[#0B4F6C]/20 bg-[#0B4F6C]/[0.03]"
                                  : "border-border/60 bg-white/40"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleIntegration(int.key)}
                                  className="flex-1 flex items-center gap-2.5"
                                >
                                  <div
                                    className={`w-8 h-5 rounded-full relative transition-colors ${
                                      enabled ? "bg-[#0B4F6C]" : "bg-muted-foreground/20"
                                    }`}
                                  >
                                    <div
                                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                                        enabled ? "left-3.5" : "left-0.5"
                                      }`}
                                    />
                                  </div>
                                  <Icon size={14} className={enabled ? "text-[#0B4F6C]" : "text-muted-foreground/50"} />
                                  <span className={`text-[12px] font-medium ${enabled ? "text-[#0B4F6C]" : "text-muted-foreground/70"}`}>
                                    {int.label}
                                  </span>
                                </button>
                                <div className="relative group/tip">
                                  <span className="p-1 rounded-md hover:bg-[#0B4F6C]/[0.06] transition-colors cursor-help inline-flex">
                                    <Info size={13} className="text-muted-foreground/50 group-hover/tip:text-[#0B4F6C]/70 transition-colors" />
                                  </span>
                                  <div className="absolute bottom-full right-0 mb-2 w-64 px-3 py-2.5 rounded-lg bg-[#1a1a1a] text-white text-[11px] leading-relaxed shadow-lg opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all duration-200 z-50 pointer-events-none">
                                    {int.tooltip}
                                    <div className="absolute top-full right-3 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-[#1a1a1a]" />
                                  </div>
                                </div>
                              </div>

                              {/* Config fields when enabled */}
                              {enabled && int.fields.length > 0 && (
                                <div className="mt-2.5 pl-[42px] space-y-2.5">
                                  {int.fields.map((field: any) => (
                                    <div key={field.name}>
                                      <label className="block text-[10px] font-medium text-muted-foreground/70 mb-0.5">
                                        {field.label}
                                      </label>
                                      <input
                                        type="text"
                                        value={integrations[int.key]?.[field.name] || ""}
                                        onChange={(e) => setField(int.key, field.name, e.target.value)}
                                        placeholder={field.placeholder}
                                        className="w-full px-2.5 py-1.5 text-[12px] rounded-md border border-border/60 bg-white/80 focus:outline-none focus:ring-1 focus:ring-[#0B4F6C]/20 placeholder:text-muted-foreground/40"
                                      />
                                      {field.hint && (
                                        <p className="text-[10px] text-muted-foreground/50 mt-0.5">{field.hint}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Error / Success */}
                    {error && (
                      <div className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                        {error}
                      </div>
                    )}

                    {success && (
                      <div className="flex items-center gap-2 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                        <Check size={14} />
                        Client created successfully!
                      </div>
                    )}

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={submitting || !name || !domain}
                      className="w-full py-2.5 text-[13px] font-semibold rounded-lg bg-[#0B4F6C] text-white hover:bg-[#0B4F6C]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {submitting ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Creating…
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          Create Client
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </Card>
        </div>

        {/* Client cards */}
        <div className="grid gap-3 md:grid-cols-2">
          {clients.map((client) => {
            const enabledSources = Object.entries(client.integrations)
              .filter(([, v]) => v?.enabled)
              .map(([k]) => k);

            return (
              <Link key={client.slug} href={`/${client.slug}`}>
                <Card className="hover:shadow-[0_4px_16px_rgba(11,79,108,0.1)] hover:border-[#0B4F6C]/[0.12] transition-all cursor-pointer">
                  <CardHeader>
                    <CardTitle className="text-[14px] text-[#0B4F6C]">
                      {client.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-[13px] text-muted-foreground mb-3">
                      {client.domain}
                    </p>
                    <div className="flex gap-1.5 flex-wrap">
                      {enabledSources.map((s) => (
                        <span
                          key={s}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#0B4F6C]/[0.06] text-[#0B4F6C]/70 tracking-wide uppercase"
                        >
                          {s === "googleAnalytics" ? "GA4" : s}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}

          {clients.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="py-12 text-center text-muted-foreground text-[13px]">
                No clients configured yet. Use the form above to add your first client.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
