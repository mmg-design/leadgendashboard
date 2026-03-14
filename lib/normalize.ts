// Unified visitor format — all sources normalize into this shape

export interface UnifiedVisitor {
  source: "vector" | "snitcher" | "ga";
  sourceId: string;

  // Company
  companyName: string | null;
  companyDomain: string | null;
  companyIndustry: string | null;
  companySize: string | null;
  companyLocation: string | null;

  // Person (when available)
  personName: string | null;
  personEmail: string | null;
  personTitle: string | null;
  personLinkedin: string | null;

  // Visit
  pageUrl: string | null;
  referrer: string | null;
  visitDate: string;
  visitCount: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function normalizeVector(raw: any): UnifiedVisitor {
  return {
    source: "vector",
    sourceId: raw.id || raw.visitor_id || String(Date.now()),
    companyName: raw.company?.name || raw.company_name || null,
    companyDomain: raw.company?.domain || raw.company_domain || null,
    companyIndustry: raw.company?.industry || null,
    companySize: raw.company?.employee_count || raw.company?.size || null,
    companyLocation: raw.company?.location || null,
    personName: null,
    personEmail: null,
    personTitle: null,
    personLinkedin: null,
    pageUrl: raw.page_url || raw.url || null,
    referrer: raw.referrer || null,
    visitDate: raw.visited_at || raw.timestamp || new Date().toISOString(),
    visitCount: raw.visit_count || 1,
  };
}

export function normalizeSnitcher(raw: any): UnifiedVisitor {
  // Snitcher webhook payload — company-level identification
  // Docs: https://help.snitcher.com/en/articles/webhooks
  const company = raw.company || raw;
  return {
    source: "snitcher",
    sourceId: raw.id || raw.session_id || String(Date.now()),
    companyName: company.name || null,
    companyDomain: company.domain || company.website || null,
    companyIndustry: company.industry || company.category || null,
    companySize: company.employee_count || company.size || company.employees || null,
    companyLocation: [company.city, company.region, company.country].filter(Boolean).join(", ") || company.location || null,
    personName: null,
    personEmail: null,
    personTitle: null,
    personLinkedin: null,
    pageUrl: raw.landing_page || raw.page_url || raw.url || null,
    referrer: raw.referrer || raw.source || null,
    visitDate: raw.last_seen || raw.visited_at || raw.timestamp || new Date().toISOString(),
    visitCount: raw.visit_count || raw.sessions || 1,
  };
}

