"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Radar, ExternalLink, Building2, RefreshCw, Loader2 } from "lucide-react";

interface Visitor {
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_size: string | null;
  company_location: string | null;
  person_name: string | null;
  person_email: string | null;
  person_title: string | null;
  sources: string;
  source_ids: string | null;
  last_visit: string;
  total_visits: number;
  pages_visited: string | null;
}

interface IntegrationConfig {
  vector?: { siteId?: string };
  snitcher?: { projectId?: string; workspaceId?: string };
}

interface VisitorTableProps {
  visitors: Visitor[];
  integrations?: IntegrationConfig;
  clientSlug: string;
  onSync?: () => void;
}

const sourceColors: Record<string, string> = {
  vector: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
  snitcher: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
};

function getSourceUrl(
  source: string,
  sourceId: string,
  companyDomain?: string | null,
  integrations?: IntegrationConfig
): string | null {
  switch (source) {
    case "vector": {
      const siteId = integrations?.vector?.siteId;
      if (siteId) return `https://app.vector.co/sites/${siteId}/leads`;
      return `https://app.vector.co`;
    }
    case "snitcher": {
      return `https://app.snitcher.com/dashboard`;
    }
    default:
      return null;
  }
}

function parseSourceIds(sourceIdsStr: string | null): Record<string, string> {
  if (!sourceIdsStr) return {};
  const map: Record<string, string> = {};
  sourceIdsStr.split(",").forEach((pair) => {
    const colonIdx = pair.indexOf(":");
    if (colonIdx > 0) {
      map[pair.substring(0, colonIdx).trim()] = pair.substring(colonIdx + 1).trim();
    }
  });
  return map;
}

function getPrimarySourceUrl(visitor: Visitor, integrations?: IntegrationConfig): string | null {
  const sourcesArr = visitor.sources.split(",").map((s) => s.trim());
  const sourceIdMap = parseSourceIds(visitor.source_ids);
  for (const s of sourcesArr) {
    const url = getSourceUrl(s, sourceIdMap[s], visitor.company_domain, integrations);
    if (url) return url;
  }
  return null;
}

export function VisitorTable({ visitors, integrations, clientSlug, onSync }: VisitorTableProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/sync-snitcher?client=${clientSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 30 }),
      });
      const data = await res.json();
      if (data.error) {
        setSyncResult(`Error: ${data.error}`);
      } else {
        setSyncResult(`Synced ${data.synced} companies`);
        onSync?.();
      }
    } catch {
      setSyncResult("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardContent className="py-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="p-2 rounded-lg bg-[#0B4F6C]/8">
            <Radar size={16} className="text-[#0B4F6C]/70" />
          </div>
          <div className="text-[17px] font-headline font-normal text-foreground/80">
            Identified Visitors
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
          Companies caught visiting via IP identification tools.
        </p>

        {/* Visitor list */}
        <div className="flex-1 space-y-1.5 mb-3 overflow-y-auto max-h-[280px] pr-1">
          {visitors.length > 0 ? (
            visitors.map((v, i) => {
              const sourcesArr = v.sources.split(",").map((s) => s.trim());
              const sourceIdMap = parseSourceIds(v.source_ids);
              const primaryUrl = getPrimarySourceUrl(v, integrations);

              return (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <Building2 size={11} className="text-[#0B4F6C]/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-foreground/70 truncate">
                      {v.company_name || "Unknown"}
                    </div>
                    <div className="text-[9px] text-muted-foreground/60 truncate">
                      {v.company_industry || v.company_domain || "—"} · {v.total_visits} visits
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {sourcesArr.map((s) => {
                      const sourceId = sourceIdMap[s];
                      const url = getSourceUrl(s, sourceId, v.company_domain, integrations);
                      if (url) {
                        return (
                          <a key={s} href={url} target="_blank" rel="noopener noreferrer">
                            <Badge
                              variant="outline"
                              className={`text-[8px] font-medium px-1 py-0 border cursor-pointer transition-colors ${sourceColors[s] || "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"}`}
                            >
                              {s}
                            </Badge>
                          </a>
                        );
                      }
                      return (
                        <Badge
                          key={s}
                          variant="outline"
                          className={`text-[8px] font-medium px-1 py-0 border ${sourceColors[s] || "bg-gray-50 text-gray-600 border-gray-200"}`}
                        >
                          {s}
                        </Badge>
                      );
                    })}
                  </div>
                  {primaryUrl && (
                    <a href={primaryUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={9} className="text-muted-foreground/30 group-hover:text-[#0B4F6C]/50 shrink-0" />
                    </a>
                  )}
                </div>
              );
            })
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-4">
              <div className="text-[28px] font-semibold text-[#0B4F6C] tracking-tight">0</div>
              <p className="text-[10px] text-muted-foreground/50 mt-1">No visitor data yet</p>
            </div>
          )}
        </div>

        {syncResult && (
          <p className={`text-[10px] text-center mb-2 ${syncResult.startsWith("Error") ? "text-red-500" : "text-emerald-600"}`}>
            {syncResult}
          </p>
        )}

        {visitors.length > 0 ? (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/50">
              {visitors.length} compan{visitors.length === 1 ? "y" : "ies"} identified
            </span>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1 text-[10px] text-[#0B4F6C]/60 hover:text-[#0B4F6C] transition-colors"
            >
              {syncing ? <Loader2 size={9} className="animate-spin" /> : <RefreshCw size={9} />}
              Sync
            </button>
          </div>
        ) : (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 text-[12px] font-medium rounded-lg bg-[#0B4F6C]/8 text-[#0B4F6C] hover:bg-[#0B4F6C]/15 transition-colors"
          >
            {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {syncing ? "Syncing..." : "Sync from Snitcher"}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
