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

    -- One Clarity pull per client per day. Clarity's API only returns the last
    -- 1-3 days, so the 7d/30d/90d views are built by adding these up.
    CREATE TABLE IF NOT EXISTS clarity_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      days_covered INTEGER NOT NULL,
      data TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_slug, snapshot_date)
    );

    -- Agents tab: one row per detected task per client. The scan rewrites the
    -- task JSON each time; status, the agent's draft, and apply results persist.
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      task_key TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      output TEXT,
      result TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_slug, task_key)
    );

    -- Website review tool: one private share link per client, the comments
    -- clients pin on their live site, and the replies on each comment.
    CREATE TABLE IF NOT EXISTS review_links (
      client_slug TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'comment',
      page_url TEXT NOT NULL,
      page_path TEXT NOT NULL,
      page_title TEXT,
      device TEXT NOT NULL,
      viewport_width INTEGER,
      anchor TEXT,
      body TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT,
      is_team INTEGER NOT NULL DEFAULT 0,
      browser TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      slack_ts TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_client ON feedback(client_slug, status);

    CREATE TABLE IF NOT EXISTS feedback_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT,
      is_team INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_replies ON feedback_replies(feedback_id);

    -- Change timeline: everything done to a client's site (agent work going
    -- live, new or removed pages, Webflow publishes, resolved feedback, notes),
    -- shown as markers on the charts. ref makes automatic events idempotent.
    CREATE TABLE IF NOT EXISTS site_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      pages TEXT,
      source TEXT NOT NULL,
      ref TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_slug, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_site_events_client ON site_events(client_slug, occurred_at);

    -- Client progress page: one private link per client, off until the team
    -- shares it. settings holds the lead value, start date, and which items
    -- are hidden or reworded for the client.
    -- The team's Google sign-in for Gmail drafts (one per dashboard). The
    -- refresh token is encrypted; it never leaves the server.
    CREATE TABLE IF NOT EXISTS google_connections (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      scopes TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_portals (
      client_slug TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      settings TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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

  // Migration: add goals column if missing (existing DBs)
  try {
    await db.execute("SELECT goals FROM clients LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE clients ADD COLUMN goals TEXT");
  }

  // Migration: add sort_order column if missing (existing DBs)
  try {
    await db.execute("SELECT sort_order FROM clients LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE clients ADD COLUMN sort_order INTEGER");
  }

  // Migration: add display_prefs column if missing (hidden sources/pages)
  try {
    await db.execute("SELECT display_prefs FROM clients LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE clients ADD COLUMN display_prefs TEXT");
  }

  // Migration: add action_items_state column if missing (existing DBs)
  try {
    await db.execute("SELECT action_items_state FROM clients LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE clients ADD COLUMN action_items_state TEXT");
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
