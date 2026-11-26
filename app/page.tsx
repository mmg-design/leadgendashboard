"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GaServiceAccountHint } from "@/components/dashboard/ga-service-account-hint";
import AccountMenu, { useViewer } from "@/components/account-menu";
import {
  ListChecks,
  Plus,
  MessageSquare,
  BarChart3,
  Search,
  Video,
  Loader2,
  Check,
  Globe,
  Building2,
  Info,
  ListTodo,
  GripVertical,
  Trash2,
  X,
  ArrowRight,
} from "lucide-react";

type IntegrationConfig = {
  enabled: boolean;
} & Record<string, string | boolean | string[] | undefined>;

interface IntegrationField {
  name: string;
  label: string;
  placeholder: string;
  hint: string;
  secret?: boolean;
}

interface ClientConfig {
  name: string;
  slug: string;
  domain: string;
  iconUrl?: string;
  integrations: Record<string, IntegrationConfig>;
}

const integrationMeta = [
  {
    key: "googleAnalytics",
    label: "Google Analytics 4",
    icon: BarChart3,
    badge: "GA4",
    tooltip: "This pulls traffic data - sessions, pageviews, top pages, etc. Open analytics.google.com, click the gear icon (Admin), then Property Settings. The Property ID is the number at the top (like 430286560). You'll also need to add our service account as a Viewer on this property - see the copyable email below once GA4 is enabled.",
    fields: [
      { name: "propertyId", label: "Property ID", placeholder: "e.g. 430286560", hint: "The number from GA4 → Admin → Property Settings" },
    ],
  },
  {
    key: "clarity",
    label: "Microsoft Clarity",
    icon: Video,
    badge: "Clarity",
    tooltip: "Clarity shows how people use each page: how far they scroll, and where they rage-click or click things that don't work. Open clarity.microsoft.com, pick the project, and the Project ID is the short code in the URL (like vsqtrrcn93). Each project needs its own API token.",
    fields: [
      { name: "projectId", label: "Project ID", placeholder: "e.g. vsqtrrcn93", hint: "The code in the URL: clarity.microsoft.com/projects/view/{this-part}" },
      { name: "apiToken", label: "API token", placeholder: "Paste this project's token", hint: "In Clarity: Settings → Data Export → Generate new API token. Tokens only work for their own project.", secret: true },
    ],
  },
  {
    key: "searchConsole",
    label: "Google Search Console",
    icon: Search,
    badge: "GSC",
    tooltip: "Search Console shows the real Google searches each page appears for and whether Google has indexed it. In Search Console, open the property, go to Settings → Users and permissions → Add user, paste the same service account email shown under GA4, and choose Full permission.",
    fields: [
      { name: "property", label: "Property", placeholder: "sc-domain:example.com", hint: "Domain property: sc-domain:example.com. URL-prefix property: https://www.example.com/ (exactly as Search Console shows it)" },
    ],
  },
  {
    key: "seRanking",
    label: "SE Ranking",
    icon: Search,
    badge: "SEO",
    tooltip: "SE Ranking tracks keyword positions and domain visibility. Open app.seranking.com, go to your project, and copy the numeric project ID from the URL.",
    fields: [
      { name: "projectId", label: "Project ID", placeholder: "e.g. 123456", hint: "The number in the SE Ranking project URL" },
    ],
  },
  {
    key: "clickup",
    label: "ClickUp",
    icon: ListTodo,
    badge: "Tasks",
    tooltip: "ClickUp shows active work, completed tasks, and recent comments. Open a list in ClickUp, copy the numeric list ID from the URL (like 901234567). You can add multiple list IDs separated by commas.",
    fields: [
      { name: "listIds", label: "List IDs (comma-separated)", placeholder: "e.g. 901234567, 901234568", hint: "From the ClickUp list URL: app.clickup.com/.../list/{this-number}" },
      { name: "engagementStartDate", label: "Engagement start date", placeholder: "YYYY-MM-DD", hint: "When this client's engagement began" },
    ],
  },
];

export default function Home() {
  const viewer = useViewer();
  const router = useRouter();
  const [clients, setClients] = useState<ClientConfig[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  // Open client-feedback comments per client (from the review tool)
  const [feedbackCounts, setFeedbackCounts] = useState<Record<string, number>>({});
  const openFeedback = Object.values(feedbackCounts).reduce((a, b) => a + b, 0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [integrations, setIntegrations] = useState<Record<string, IntegrationConfig>>({
    googleAnalytics: { enabled: false, propertyId: "" },
    clarity: { enabled: false, projectId: "", apiToken: "" },
    searchConsole: { enabled: false, property: "" },
    seRanking: { enabled: false, projectId: "" },
    clickup: { enabled: false, listIds: "", engagementStartDate: "" },
  });

  const fetchClients = () => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data) => setClients(data.clients || []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchClients();
    fetch("/api/feedback/summary")
      .then((r) => r.json())
      .then((data: { open?: Record<string, number> }) => setFeedbackCounts(data.open || {}))
      .catch(() => {});
  }, []);

  // Drag-to-reorder
  const [dragSlug, setDragSlug] = useState<string | null>(null);

  const handleDragStart = (slug: string) => setDragSlug(slug);

  const handleDragOver = (e: React.DragEvent, overSlug: string) => {
    e.preventDefault();
    if (!dragSlug || dragSlug === overSlug) return;

    setClients((prev) => {
      const fromIndex = prev.findIndex((c) => c.slug === dragSlug);
      const toIndex = prev.findIndex((c) => c.slug === overSlug);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleDragEnd = () => {
    setDragSlug(null);
    fetch("/api/clients/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs: clients.map((c) => c.slug) }),
    }).catch(() => {});
  };

  // Delete client (two-step inline confirm, no native browser dialog)
  const [pendingDeleteSlug, setPendingDeleteSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  const handleDeleteConfirm = async (slug: string) => {
    setDeletingSlug(slug);
    try {
      await fetch(`/api/clients?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      setClients((prev) => prev.filter((c) => c.slug !== slug));
    } catch {
      // leave the card in place if the delete failed
    } finally {
      setDeletingSlug(null);
      setPendingDeleteSlug(null);
    }
  };

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
    setIconUrl("");
    setIntegrations({
      googleAnalytics: { enabled: false, propertyId: "" },
      clarity: { enabled: false, projectId: "", apiToken: "" },
      searchConsole: { enabled: false, property: "" },
      seRanking: { enabled: false, projectId: "" },
      clickup: { enabled: false, listIds: "", engagementStartDate: "" },
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
        body: JSON.stringify({ name, domain, iconUrl: iconUrl || undefined, integrations }),
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
    <div className="min-h-screen page-wash text-[#1D475E] relative overflow-hidden">
      {/* Soft ice wash with blue glows, like the mmg.studio hero */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-[radial-gradient(ellipse_60%_50%_at_20%_45%,rgba(74,162,192,0.16),transparent_70%),radial-gradient(ellipse_50%_45%_at_85%_15%,rgba(74,162,192,0.12),transparent_70%),linear-gradient(180deg,#F7FCFD_0%,#EEF7F9_60%,#F3FAFB_100%)]" />

      {/* Floating nav */}
      <div className="relative z-10 px-4 md:px-8 pt-5">
        <nav className="max-w-[1240px] mx-auto h-[68px] px-4 md:px-5 flex items-center justify-between rounded-2xl bg-white border border-[#1D475E]/[0.08] shadow-[0_1px_4px_rgba(29,71,94,0.06),0_8px_24px_rgba(29,71,94,0.06)]">
          <div className="flex items-center gap-2.5">
            <Image src="/mmg-icon.png" alt="MMG" width={32} height={32} className="rounded-lg" />
            <span className="text-[21px] font-semibold tracking-[-0.02em] text-[#131B30]">MMG Studio</span>
          </div>
          <div className="flex items-center gap-2.5">
            {openFeedback > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] font-medium text-[#3E4F5E]">
                <MessageSquare size={14} className="text-[#4AA2C0]" /> {openFeedback} open client {openFeedback === 1 ? "update" : "updates"}
              </span>
            )}
            {viewer && (
              <Link href="/work" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[15px] font-medium text-[#1D475E] hover:bg-[#F3FAFB]">
                <ListChecks size={16} /> {viewer.isOwner ? "Work" : "My queue"}
              </Link>
            )}
            {viewer?.isOwner && (
              <button
                onClick={() => { setFormOpen(true); setSuccess(false); }}
                className="inline-flex items-center gap-1.5 btn-mmg-blue px-4 md:px-5 py-2.5 text-[15px]"
              >
                <Plus size={16} /> New client
              </button>
            )}
            <AccountMenu />
          </div>
        </nav>
      </div>

      <div className="relative max-w-[1240px] mx-auto pt-16 md:pt-24 pb-24 px-4 md:px-8">
        {/* Hero */}
        <div className="mb-16 md:mb-24 max-w-4xl mx-auto text-center">
          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
            <span className="inline-flex items-center gap-2 rounded-lg bg-white border border-[#1D475E]/[0.08] px-3.5 py-2 text-[14px] text-[#3E4F5E] shadow-[0_1px_4px_rgba(29,71,94,0.06)]">
              <Building2 size={15} className="text-[#4AA2C0]" /> {clients.length} client {clients.length === 1 ? "site" : "sites"}
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg bg-white border border-[#1D475E]/[0.08] px-3.5 py-2 text-[14px] text-[#3E4F5E] shadow-[0_1px_4px_rgba(29,71,94,0.06)]">
              <MessageSquare size={15} className="text-[#4AA2C0]" /> {openFeedback} open client {openFeedback === 1 ? "update" : "updates"}
            </span>
          </div>
          <h1 className="text-[clamp(2.75rem,6.5vw,5.25rem)] text-balance leading-[1.04] font-headline font-normal tracking-[-0.03em] text-[#1D475E]">
            Every number that grows your website, <span className="text-[#2B97B5]">in one view.</span>
          </h1>
          <p className="mt-7 mx-auto max-w-2xl text-balance text-[18px] md:text-[20px] leading-relaxed text-[#3E4F5E]">
            Track search rankings, AI visibility, traffic and leads, then see what to fix next.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {viewer?.isOwner && (
              <button
                onClick={() => { setFormOpen(true); setSuccess(false); }}
                className="inline-flex items-center gap-2 btn-mmg-blue px-7 py-3.5 text-[16px]"
              >
                Add a client <ArrowRight size={17} />
              </button>
            )}
            <a
              href="#clients"
              className="inline-flex items-center btn-mmg-white px-7 py-3.5 text-[16px]"
            >
              See all clients
            </a>
          </div>
        </div>

        {/* Add client (modal) */}
        {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#001A2E]/70 backdrop-blur-sm px-4 py-10" onClick={() => setFormOpen(false)}>
          <Card className="w-full max-w-3xl overflow-hidden bg-white border-white/10 shadow-[0_22px_70px_rgba(0,0,0,0.3)]" onClick={(e) => e.stopPropagation()}>
            <div className="w-full px-7 py-6 flex items-center justify-between text-left">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#0CA4C3]/10 flex items-center justify-center">
                  <Plus size={20} className="text-[#0394B2]" />
                </div>
                <div>
                  <div className="text-[24px] font-headline font-normal text-[#001A2E]">
                    Add New Client
                  </div>
                  <div className="text-[16px] text-muted-foreground mt-1">
                    Configure integrations and start tracking
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/60" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {/* Form */}
              <form onSubmit={handleSubmit}>
                <div className="px-6 pb-6 border-t border-border/50">
                  <div className="pt-5 space-y-5">
                    {/* Client info */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Client Name
                        </label>
                        <div className="relative">
                          <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#097388]/55" />
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. MMG Design Studio"
                            required
                            className="w-full pl-9 pr-3 py-2 text-[14px] rounded-lg border border-border bg-white/60 focus:outline-none focus:ring-2 focus:ring-[#001A2E]/20 focus:border-[#001A2E]/30 transition-all placeholder:text-[#097388]/55"
                          />
                        </div>
                        <p className="text-[11px] text-[#097388]/65 mt-1">The client&apos;s business name - this shows up as the dashboard title</p>
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Domain
                        </label>
                        <div className="relative">
                          <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#097388]/55" />
                          <input
                            type="text"
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            placeholder="e.g. mmg.studio"
                            required
                            className="w-full pl-9 pr-3 py-2 text-[14px] rounded-lg border border-border bg-white/60 focus:outline-none focus:ring-2 focus:ring-[#001A2E]/20 focus:border-[#001A2E]/30 transition-all placeholder:text-[#097388]/55"
                          />
                        </div>
                        <p className="text-[11px] text-[#097388]/65 mt-1">Their website URL without https:// - just the domain like &quot;mmg.studio&quot;</p>
                      </div>
                    </div>

                    {/* Icon URL */}
                    <div>
                      <label className="block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Icon URL <span className="font-normal normal-case">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={iconUrl}
                        onChange={(e) => setIconUrl(e.target.value)}
                        placeholder="e.g. /clients/my-client/icon.svg or https://..."
                        className="w-full px-3 py-2 text-[14px] rounded-lg border border-border bg-white/60 focus:outline-none focus:ring-2 focus:ring-[#001A2E]/20 focus:border-[#001A2E]/30 transition-all placeholder:text-[#097388]/55"
                      />
                      <p className="text-[11px] text-[#097388]/65 mt-1">Path or URL to the client&apos;s logo/icon - displayed in the dashboard header</p>
                    </div>

                    {/* Integrations */}
                    <div>
                      <label className="block text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
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
                                  ? "border-[#001A2E]/20 bg-[#001A2E]/[0.03]"
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
                                      enabled ? "bg-[#001A2E]" : "bg-muted-foreground/20"
                                    }`}
                                  >
                                    <div
                                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                                        enabled ? "left-3.5" : "left-0.5"
                                      }`}
                                    />
                                  </div>
                                  <Icon size={14} className={enabled ? "text-[#001A2E]" : "text-[#097388]/65"} />
                                  <span className={`text-[13px] font-medium ${enabled ? "text-[#001A2E]" : "text-muted-foreground/70"}`}>
                                    {int.label}
                                  </span>
                                </button>
                                <div className="relative group/tip">
                                  <span className="p-1 rounded-md hover:bg-[#001A2E]/[0.06] transition-colors cursor-help inline-flex">
                                    <Info size={13} className="text-[#097388]/65 group-hover/tip:text-[#001A2E]/70 transition-colors" />
                                  </span>
                                  <div className="absolute bottom-full right-0 mb-2 w-64 px-3 py-2.5 rounded-lg bg-[#001A2E] text-white text-[12px] leading-relaxed shadow-lg opacity-0 invisible group-hover/tip:opacity-100 group-hover/tip:visible transition-all duration-200 z-50 pointer-events-none">
                                    {int.tooltip}
                                    <div className="absolute top-full right-3 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-[#001A2E]" />
                                  </div>
                                </div>
                              </div>

                              {/* Config fields when enabled */}
                              {enabled && int.fields.length > 0 && (
                                <div className="mt-2.5 pl-[42px] space-y-2.5">
                                  {int.fields.map((field: IntegrationField) => (
                                    <div key={field.name}>
                                      <label className="block text-[11px] font-medium text-muted-foreground/70 mb-0.5">
                                        {field.label}
                                      </label>
                                      <input
                                        type={field.secret ? "password" : "text"}
                                        autoComplete={field.secret ? "off" : undefined}
                                        value={String(integrations[int.key]?.[field.name] || "")}
                                        onChange={(e) => setField(int.key, field.name, e.target.value)}
                                        placeholder={field.placeholder}
                                        className="w-full px-2.5 py-1.5 text-[13px] rounded-md border border-border/60 bg-white/80 focus:outline-none focus:ring-1 focus:ring-[#001A2E]/20 placeholder:text-[#097388]/55"
                                      />
                                      {field.hint && (
                                        <p className="text-[11px] text-[#097388]/65 mt-0.5">{field.hint}</p>
                                      )}
                                    </div>
                                  ))}
                                  {(int.key === "googleAnalytics" || int.key === "searchConsole") && <GaServiceAccountHint />}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Error / Success */}
                    {error && (
                      <div className="text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                        {error}
                      </div>
                    )}

                    {success && (
                      <div className="flex items-center gap-2 text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                        <Check size={14} />
                        Client created successfully!
                      </div>
                    )}

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={submitting || !name || !domain}
                      className="btn-mmg-blue w-full py-2.5 text-[14px] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
          </Card>
        </div>
        )}

        {/* Client cards */}
        <div id="clients" className="scroll-mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => {
            const enabledSources = integrationMeta.filter(
              (integration) => client.integrations[integration.key]?.enabled
            );
            const isPendingDelete = pendingDeleteSlug === client.slug;
            const isDeleting = deletingSlug === client.slug;

            return (
              <div
                key={client.slug}
                draggable
                onDragStart={() => handleDragStart(client.slug)}
                onDragOver={(e) => handleDragOver(e, client.slug)}
                onDragEnd={handleDragEnd}
                onClick={() => !isPendingDelete && router.push(`/${client.slug}`)}
                className={`transition-opacity ${dragSlug === client.slug ? "opacity-40" : ""}`}
              >
                <Card className="relative group h-full bg-white pt-0 rounded-xl border-[#1D475E]/[0.06] shadow-[0_2px_8px_rgba(29,71,94,0.06),0_8px_24px_rgba(29,71,94,0.08)] hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(29,71,94,0.08),0_16px_48px_rgba(29,71,94,0.12)] transition-all duration-300 cursor-pointer">
                  <div
                    className="absolute left-2 top-2 z-10 rounded-md bg-white/90 p-1 text-[#097388]/60 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Drag to reorder"
                  >
                    <GripVertical size={14} />
                  </div>

                  <div
                    className="absolute right-2 top-2 z-10 rounded-md bg-white/90 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isPendingDelete ? (
                      <div className="flex items-center gap-1 bg-white rounded-lg shadow-sm border border-border/60 px-1.5 py-1">
                        <button
                          onClick={() => handleDeleteConfirm(client.slug)}
                          disabled={isDeleting}
                          title="Confirm delete"
                          className="p-1 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        </button>
                        <button
                          onClick={() => setPendingDeleteSlug(null)}
                          title="Cancel"
                          className="p-1 rounded-md text-muted-foreground hover:bg-muted/60 transition-colors"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPendingDeleteSlug(client.slug)}
                        title="Delete client"
                        className="p-1.5 rounded-md text-[#097388]/55 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  {/* Homepage screenshot, refreshed daily on the server */}
                  <div className="relative aspect-[16/9] overflow-hidden border-b border-[#1D475E]/[0.08] bg-[#EAF5F7]">
                    <Image
                      src={`/api/clients/preview?slug=${client.slug}`}
                      alt={`${client.domain} homepage`}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                      unoptimized
                      className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]"
                      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                    />
                  </div>

                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-[24px] font-headline font-normal text-[#1D475E]">
                      {client.iconUrl ? (
                        <span className="relative size-7 overflow-hidden rounded-md shrink-0">
                          <Image
                            src={client.iconUrl}
                            alt={`${client.name} icon`}
                            fill
                            sizes="28px"
                            unoptimized={client.iconUrl.startsWith("data:")}
                            className="object-cover"
                          />
                        </span>
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-[#001A2E]/8 flex items-center justify-center shrink-0">
                          <Building2 size={14} className="text-[#001A2E]/40" />
                        </div>
                      )}
                      {client.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <p className="text-[15px] text-[#5F7A8A] truncate">{client.domain}</p>
                      {(feedbackCounts[client.slug] || 0) > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[#E87BA4]/12 px-2.5 py-1 text-[12px] font-semibold text-[#9C2F5A]">
                          <MessageSquare size={12} /> {feedbackCounts[client.slug]} open
                        </span>
                      )}
                    </div>
                    {enabledSources.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {enabledSources.map((source) => {
                          const Icon = source.icon;
                          return (
                            <span
                              key={source.key}
                              className="inline-flex items-center gap-1.5 rounded-full bg-[#EAF5F7] px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-[#1D475E] uppercase"
                            >
                              <Icon size={12} strokeWidth={2} className="text-[#4AA2C0]" />
                              {source.badge}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}

          {clients.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="py-12 text-center text-muted-foreground text-[14px]">
                No clients yet. Use New client to add your first one.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
