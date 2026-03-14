import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let initialized = false;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:./data/leads.db";
    const authToken = process.env.TURSO_AUTH_TOKEN;
    client = createClient({ url, authToken });
  }
  return client;
}

async function initSchema(db: Client) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      company_name TEXT,
      company_domain TEXT,
      company_industry TEXT,
      company_size TEXT,
      company_location TEXT,
      person_name TEXT,
      person_email TEXT,
      person_title TEXT,
      person_linkedin TEXT,
      page_url TEXT,
      referrer TEXT,
      visit_date TEXT NOT NULL,
      visit_count INTEGER DEFAULT 1,
      raw_data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_slug, source, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_visitors_client ON visitors(client_slug);
    CREATE INDEX IF NOT EXISTS idx_visitors_date ON visitors(visit_date);
    CREATE INDEX IF NOT EXISTS idx_visitors_company ON visitors(company_domain);

    CREATE TABLE IF NOT EXISTS analytics_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      date_range TEXT NOT NULL,
      data TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_slug, metric_type, date_range)
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      icon_url TEXT,
      integrations TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: add icon_url column if missing (existing DBs)
  try {
    await db.execute("SELECT icon_url FROM clients LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE clients ADD COLUMN icon_url TEXT");
  }
}

export async function getDb(): Promise<Client> {
  const db = getClient();
  if (!initialized) {
    await initSchema(db);
    initialized = true;
  }
  return db;
}
