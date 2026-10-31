// Link prospect names and labels, shared by the server code in
// lib/link-prospects.ts and the Links tab (which can't import the database).

export type Stage = "not_started" | "in_progress" | "follow_up" | "completed" | "dismissed";
export type Effort = "easy" | "medium" | "hard";
export type ProspectKind = "local" | "partner" | "industry" | "press" | "resource" | "podcast" | "community" | "competitor_gap";

export const STAGES: Stage[] = ["not_started", "in_progress", "follow_up", "completed", "dismissed"];
export const STAGE_LABEL: Record<Stage, string> = {
  not_started: "Not started", in_progress: "In progress", follow_up: "Follow-up", completed: "Completed", dismissed: "Dismissed",
};
export const KIND_LABEL: Record<ProspectKind, string> = {
  local: "Local", partner: "Partner", industry: "Industry", press: "Press", resource: "Resource page", podcast: "Podcast", community: "Community", competitor_gap: "Competitor link",
};
export const EFFORT_LABEL: Record<Effort, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export interface LinkProfile {
  business: string; // what the company does and what makes it different
  customers: string; // who buys, and what they search for
  area: string; // where it serves
  relationships: string; // partners, carriers, vendors, associations, sponsorships
  pages: string; // which client pages links should point to, and for what
  avoid: string; // sites or angles to stay away from
  updatedBy: "Claude" | "Team";
  updatedAt: string;
}

export const PROFILE_FIELDS: { key: keyof Omit<LinkProfile, "updatedBy" | "updatedAt">; label: string; hint: string }[] = [
  { key: "business", label: "The business", hint: "What it does and what sets it apart" },
  { key: "customers", label: "Customers", hint: "Who buys, and what they look for" },
  { key: "area", label: "Area served", hint: "Cities, counties or states" },
  { key: "relationships", label: "Existing relationships", hint: "Partners, carriers, vendors, associations, sponsorships" },
  { key: "pages", label: "Pages to link to", hint: "Which page each kind of link should point at" },
  { key: "avoid", label: "Avoid", hint: "Sites, topics or claims to stay away from" },
];

