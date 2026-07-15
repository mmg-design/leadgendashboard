"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GaServiceAccountHint } from "@/components/dashboard/ga-service-account-hint";
import {
  Plus,
  ChevronDown,
  ChevronUp,
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
} from "lucide-react";

type IntegrationConfig = {
  enabled: boolean;
} & Record<string, string | boolean | string[] | undefined>;

interface IntegrationField {
  name: string;
  label: string;
  placeholder: string;
  hint: string;
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
    tooltip: "Clarity shows which pages people engage with most - scroll depth, time spent, clicks. Open clarity.microsoft.com, pick the project, and the Project ID is the short code in the URL (like vsqtrrcn93).",
    fields: [
      { name: "projectId", label: "Project ID", placeholder: "e.g. vsqtrrcn93", hint: "The code in the URL: clarity.microsoft.com/projects/view/{this-part}" },
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
  const router = useRouter();
  const [clients, setClients] = useState<ClientConfig[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [integrations, setIntegrations] = useState<Record<string, IntegrationConfig>>({
    googleAnalytics: { enabled: false, propertyId: "" },
    clarity: { enabled: false, projectId: "" },
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
      clarity: { enabled: false, projectId: "" },
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
    <div className="min-h-screen bg-[#001A2E] text-white relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_5%,rgba(12,164,195,0.24),transparent_34%),radial-gradient(circle_at_92%_30%,rgba(3,148,178,0.18),transparent_30%),linear-gradient(145deg,#001A2E_0%,#01384C_55%,#072732_100%)]" />
      <div className="relative max-w-6xl mx-auto py-20 md:py-28 px-5 md:px-10">
        {/* Header */}
        <div className="mb-14 md:mb-20">
          <div className="flex items-center gap-4 mb-5">
            <h1 className="whitespace-nowrap text-[clamp(2.75rem,6.25vw,4.75rem)] leading-none font-headline font-normal tracking-[-0.03em] text-white">
              Website LeadGen
            </h1>
          </div>
          <p className="max-w-2xl text-[18px] md:text-[20px] leading-relaxed text-white/70">
            Manage clients and view their website visibility and lead data.
          </p>
        </div>

        {/* Add Client Card */}
        <div className="mb-12">
          <Card className="overflow-hidden bg-white border-white/10 shadow-[0_22px_70px_rgba(0,0,0,0.22)]">
            {/* Toggle header */}
            <button
              onClick={() => { setFormOpen(!formOpen); if (success) setSuccess(false); }}
              className="w-full px-7 py-6 flex items-center justify-between text-left hover:bg-[#001A2E]/[0.025] transition-colors"
            >
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
                                        type="text"
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
                                  {int.key === "googleAnalytics" && <GaServiceAccountHint />}
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
                      className="w-full py-2.5 text-[14px] font-semibold rounded-lg bg-[#0CA4C3] text-white hover:bg-[#0394B2] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
        <div className="mb-7 flex items-end justify-between gap-6">
          <div>
            <div className="text-[14px] font-medium uppercase tracking-[0.12em] text-[#45D7DF] mb-2">Client portfolio</div>
            <h2 className="font-headline text-[clamp(2rem,4vw,3.25rem)] text-white">Your active dashboards</h2>
          </div>
          <p className="hidden md:block max-w-sm text-[15px] leading-relaxed text-white/60">Open a workspace to review performance, attribution, search visibility, and active marketing work.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {clients.map((client) => {
            const enabledSources = Object.entries(client.integrations)
              .filter(([, v]) => v?.enabled)
              .map(([k]) => k);
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
                <Card className="relative group min-h-[220px] bg-white hover:-translate-y-1 hover:shadow-[0_22px_55px_rgba(0,0,0,0.22)] hover:border-[#0CA4C3]/30 transition-all duration-300 cursor-pointer">
                  <div
                    className="absolute left-2 top-2 p-1 text-[#097388]/45 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Drag to reorder"
                  >
                    <GripVertical size={14} />
                  </div>

                  <div
                    className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity"
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

                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-[24px] font-headline font-normal text-[#001A2E]">
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
                  <CardContent>
                    <p className="text-[15px] text-muted-foreground mb-5">
                      {client.domain}
                    </p>
                    <div className="flex gap-1.5 flex-wrap">
                      {enabledSources.map((s) => (
                        <span
                          key={s}
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#001A2E]/[0.06] text-[#001A2E]/70 tracking-wide uppercase"
                        >
                          {s === "googleAnalytics" ? "GA4" : s === "seRanking" ? "SEO" : s === "clickup" ? "Tasks" : s}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}

          {clients.length === 0 && (
            <Card className="col-span-full">
              <CardContent className="py-12 text-center text-muted-foreground text-[14px]">
                No clients configured yet. Use the form above to add your first client.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
