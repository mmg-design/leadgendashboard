"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  source_ids: string | null; // "vector:abc123,snitcher:xyz456"
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

// Build deep-link URLs for each source platform
function getSourceUrl(
  source: string,
  sourceId: string,
  companyDomain?: string | null,
  integrations?: IntegrationConfig
): string | null {
  switch (source) {
    case "vector": {
      const siteId = integrations?.vector?.siteId;
      if (siteId) {
        return `https://app.vector.co/sites/${siteId}/leads`;
      }
      return `https://app.vector.co`;
    }
    case "snitcher": {
      const projectId = integrations?.snitcher?.projectId;
      const base = projectId
        ? `https://app.snitcher.com/projects/${projectId}`
        : `https://app.snitcher.com`;
      if (companyDomain) {
        return `${base}/search?q=${encodeURIComponent(companyDomain)}`;
      }
      return base;
    }
    default:
      return null;
  }
}

// Parse "vector:abc123,snitcher:xyz456" into a map
function parseSourceIds(sourceIdsStr: string | null): Record<string, string> {
  if (!sourceIdsStr) return {};
  const map: Record<string, string> = {};
  sourceIdsStr.split(",").forEach((pair) => {
    const colonIdx = pair.indexOf(":");
    if (colonIdx > 0) {
      const source = pair.substring(0, colonIdx).trim();
      const id = pair.substring(colonIdx + 1).trim();
      map[source] = id;
    }
  });
  return map;
}

export function VisitorTable({ visitors, integrations }: VisitorTableProps) {
  return (
    <Card className="col-span-full">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Radar size={15} className="text-muted-foreground/60" />
          <div>
            <CardTitle className="text-[13px] font-medium text-muted-foreground">
              Identified Visitors
            </CardTitle>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Companies identified via Vector &amp; Snitcher webhooks
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-b border-black/[0.04]">
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">Company</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">Industry</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">Location</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">Sources</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium">Pages</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium text-right">Visits</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium text-right">Last Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visitors.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground/60 py-12 text-[13px]">
                  No visitors identified yet. Webhook data from Vector and Snitcher will appear here.
                </TableCell>
              </TableRow>
            )}
            {visitors.map((v, i) => {
              const sourceIdMap = parseSourceIds(v.source_ids);
              const sourcesArr = v.sources.split(",").map((s) => s.trim());

              return (
                <TableRow key={i} className="border-b border-black/[0.03] hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div className="text-[13px] font-medium">{v.company_name || "Unknown"}</div>
                    {v.company_domain && (
                      <div className="text-[11px] text-muted-foreground">
                        {v.company_domain}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {v.company_industry || "—"}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {v.company_location || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {sourcesArr.map((s) => {
                        const sourceId = sourceIdMap[s];
                        const url = getSourceUrl(s, sourceId, v.company_domain, integrations);

                        if (url) {
                          return (
                            <a
                              key={s}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 no-underline"
                            >
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-medium px-1.5 py-0 border cursor-pointer transition-colors ${sourceColors[s] || "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"}`}
                              >
                                {s}
                                <ExternalLink size={8} className="ml-0.5 opacity-60" />
                              </Badge>
                            </a>
                          );
                        }

                        return (
                          <Badge
                            key={s}
                            variant="outline"
                            className={`text-[10px] font-medium px-1.5 py-0 border ${sourceColors[s] || "bg-gray-50 text-gray-600 border-gray-200"}`}
                          >
                            {s}
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-[11px] text-muted-foreground max-w-[180px] truncate">
                      {v.pages_visited || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-[13px] font-medium tabular-nums">
                    {v.total_visits}
                  </TableCell>
                  <TableCell className="text-right text-[12px] text-muted-foreground tabular-nums">
                    {new Date(v.last_visit).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
