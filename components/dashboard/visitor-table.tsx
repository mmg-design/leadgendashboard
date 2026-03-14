"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Radar, ExternalLink } from "lucide-react";

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
  snitcher?: { projectId?: string };
}

interface VisitorTableProps {
  visitors: Visitor[];
  integrations?: IntegrationConfig;
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
      const projectId = integrations?.snitcher?.projectId;
      const base = projectId
        ? `https://app.snitcher.com/projects/${projectId}`
        : `https://app.snitcher.com`;
      if (companyDomain) return `${base}/search?q=${encodeURIComponent(companyDomain)}`;
      return base;
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

export function VisitorTable({ visitors, integrations }: VisitorTableProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardContent className="py-4 flex-1 flex flex-col">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="p-2 rounded-lg bg-[#0B4F6C]/8">
            <Radar size={16} className="text-[#0B4F6C]/70" />
          </div>
          <div className="text-[13px] font-medium text-foreground/80">
            Identified Visitors
          </div>
        </div>

        {visitors.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center">
            <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
              Companies visiting the site will appear here once Vector and Snitcher webhooks start sending data.
            </p>
            <div className="text-[28px] font-semibold text-[#0B4F6C] tracking-tight">
              0
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 tracking-wide uppercase">
              Companies ID&apos;d
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2.5">
            {visitors.slice(0, 5).map((v, i) => {
              const sourceIdMap = parseSourceIds(v.source_ids);
              const sourcesArr = v.sources.split(",").map((s) => s.trim());

              return (
                <div key={i} className="p-2.5 rounded-lg bg-muted/30 border border-border/40">
                  <div className="text-[12px] font-medium truncate">
                    {v.company_name || "Unknown"}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {v.company_industry || v.company_domain || "—"} · {v.total_visits} visits
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    {sourcesArr.map((s) => {
                      const sourceId = sourceIdMap[s];
                      const url = getSourceUrl(s, sourceId, v.company_domain, integrations);
                      if (url) {
                        return (
                          <a key={s} href={url} target="_blank" rel="noopener noreferrer">
                            <Badge
                              variant="outline"
                              className={`text-[9px] font-medium px-1.5 py-0 border cursor-pointer transition-colors ${sourceColors[s] || "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"}`}
                            >
                              {s}
                              <ExternalLink size={7} className="ml-0.5 opacity-60" />
                            </Badge>
                          </a>
                        );
                      }
                      return (
                        <Badge
                          key={s}
                          variant="outline"
                          className={`text-[9px] font-medium px-1.5 py-0 border ${sourceColors[s] || "bg-gray-50 text-gray-600 border-gray-200"}`}
                        >
                          {s}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {visitors.length > 5 && (
              <p className="text-[10px] text-muted-foreground text-center">
                +{visitors.length - 5} more
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
