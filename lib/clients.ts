import { getDb } from "./db";

export interface GoalConfig {
  id: string;
  conversionType: "pageview" | "event";
  conversionValue: string;
  label?: string;
}

export interface ClientConfig {
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
      auditHealthScore?: number;
    };
    clickup?: {
      enabled: boolean;
      listIds: string[];
      workspaceId?: string;
      teamMemberIds?: string[];
      engagementStartDate?: string;
    };
  };
  goals: GoalConfig[];
}

// Accepts either the current array shape or the legacy single-goal-object shape,
// and backfills an id for older records that predate multi-goal support.
function normalizeGoals(raw: string | null): GoalConfig[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const list: Partial<GoalConfig>[] = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .filter((g) => g && g.conversionType && g.conversionValue)
    .map((g, i) => ({
      id: g.id || `goal-${i}`,
      conversionType: g.conversionType as "pageview" | "event",
      conversionValue: g.conversionValue as string,
      label: g.label,
    }));
}

function rowToConfig(row: Record<string, unknown>): ClientConfig {
  return {
    name: row.name as string,
    slug: row.slug as string,
    domain: row.domain as string,
    iconUrl: (row.icon_url as string) || undefined,
    integrations: JSON.parse(row.integrations as string),
    goals: normalizeGoals(row.goals as string | null),
  };
}

export async function getAllClients(): Promise<ClientConfig[]> {
  const db = await getDb();
  const result = await db.execute("SELECT * FROM clients ORDER BY sort_order IS NULL, sort_order, id");
  return result.rows.map((row) => rowToConfig(row as Record<string, unknown>));
}

export async function getClient(slug: string): Promise<ClientConfig | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT * FROM clients WHERE slug = ?",
    args: [slug],
  });
  if (result.rows.length === 0) return null;
  return rowToConfig(result.rows[0] as Record<string, unknown>);
}

export async function createClient(config: Omit<ClientConfig, "goals">): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: "INSERT INTO clients (slug, name, domain, icon_url, integrations) VALUES (?, ?, ?, ?, ?)",
    args: [config.slug, config.name, config.domain, config.iconUrl || null, JSON.stringify(config.integrations)],
  });
}

export async function updateClient(
  slug: string,
  updates: {
    name?: string;
    iconUrl?: string;
    integrations?: ClientConfig["integrations"];
    goals?: GoalConfig[];
  }
): Promise<void> {
  const db = await getDb();
  const current = await getClient(slug);
  if (!current) throw new Error("Client not found");

  const newName = updates.name !== undefined ? updates.name : current.name;
  const newIconUrl = updates.iconUrl !== undefined ? updates.iconUrl : current.iconUrl;
  const newIntegrations = updates.integrations
    ? { ...current.integrations, ...updates.integrations }
    : current.integrations;
  const newGoals = updates.goals !== undefined ? updates.goals : current.goals;

  await db.execute({
    sql: "UPDATE clients SET name = ?, icon_url = ?, integrations = ?, goals = ? WHERE slug = ?",
    args: [newName, newIconUrl || null, JSON.stringify(newIntegrations), JSON.stringify(newGoals), slug],
  });
}

export async function deleteClient(slug: string): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM clients WHERE slug = ?", args: [slug] });
  await db.execute({ sql: "DELETE FROM analytics_cache WHERE client_slug = ?", args: [slug] });
}

export async function reorderClients(slugs: string[]): Promise<void> {
  const db = await getDb();
  await Promise.all(
    slugs.map((slug, index) =>
      db.execute({ sql: "UPDATE clients SET sort_order = ? WHERE slug = ?", args: [index, slug] })
    )
  );
}

export async function clientExists(slug: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT 1 FROM clients WHERE slug = ?",
    args: [slug],
  });
  return result.rows.length > 0;
}
