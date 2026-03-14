import { getDb } from "./db";

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
    vector?: {
      enabled: boolean;
      webhookEnabled?: boolean;
      siteId?: string;
    };
    snitcher?: {
      enabled: boolean;
      webhookEnabled?: boolean;
      projectId?: string;
      workspaceId?: string;
    };
    clarity?: {
      enabled: boolean;
      projectId: string;
    };
  };
}

function rowToConfig(row: Record<string, unknown>): ClientConfig {
  return {
    name: row.name as string,
    slug: row.slug as string,
    domain: row.domain as string,
    iconUrl: (row.icon_url as string) || undefined,
    integrations: JSON.parse(row.integrations as string),
  };
}

export async function getAllClients(): Promise<ClientConfig[]> {
  const db = await getDb();
  const result = await db.execute("SELECT * FROM clients ORDER BY name");
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

export async function createClient(config: ClientConfig): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: "INSERT INTO clients (slug, name, domain, icon_url, integrations) VALUES (?, ?, ?, ?, ?)",
    args: [config.slug, config.name, config.domain, config.iconUrl || null, JSON.stringify(config.integrations)],
  });
}

export async function updateClient(
  slug: string,
  updates: { name?: string; iconUrl?: string; integrations?: ClientConfig["integrations"] }
): Promise<void> {
  const db = await getDb();
  const current = await getClient(slug);
  if (!current) throw new Error("Client not found");

  const newName = updates.name !== undefined ? updates.name : current.name;
  const newIconUrl = updates.iconUrl !== undefined ? updates.iconUrl : current.iconUrl;
  const newIntegrations = updates.integrations
    ? { ...current.integrations, ...updates.integrations }
    : current.integrations;

  await db.execute({
    sql: "UPDATE clients SET name = ?, icon_url = ?, integrations = ? WHERE slug = ?",
    args: [newName, newIconUrl || null, JSON.stringify(newIntegrations), slug],
  });
}

export async function clientExists(slug: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT 1 FROM clients WHERE slug = ?",
    args: [slug],
  });
  return result.rows.length > 0;
}
