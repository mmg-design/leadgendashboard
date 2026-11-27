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

    -- Commenter profile photos (small JPEGs as data URLs), keyed by email and
    -- by name so comments left before an email was added still match.
    CREATE TABLE IF NOT EXISTS feedback_avatars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      author_key TEXT NOT NULL,
      image TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_slug, author_key)
    );

    -- Feedback emails waiting to go out: client activity for the team's
    -- digest, team replies and status changes for the commenters. Sent in
    -- batches once activity goes quiet; claim stops two senders doubling up.
    CREATE TABLE IF NOT EXISTS feedback_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      feedback_id INTEGER NOT NULL,
      audience TEXT NOT NULL,
      event TEXT NOT NULL,
      actor TEXT NOT NULL,
      body TEXT,
      link TEXT NOT NULL,
      claim TEXT,
      claimed_at TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_outbox_pending ON feedback_outbox(sent_at);

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

    -- Link building: sites worth a link for each client, researched in Claude
    -- Code from the client's link profile, then worked through by the team
    -- (not started, in progress, follow-up, completed). domain is unique per
    -- client so a dismissed prospect never comes back.
    CREATE TABLE IF NOT EXISTS link_prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL,
      domain TEXT NOT NULL,
      data TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'not_started',
      notes TEXT,
      stage_changed_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_slug, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_link_prospects_client ON link_prospects(client_slug, stage);

    -- What each client is, who it serves and which pages links should point
    -- at. Claude drafts it; once the team edits it, research never overwrites it.
    CREATE TABLE IF NOT EXISTS link_profiles (
      client_slug TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_by TEXT NOT NULL,
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

    -- Team accounts: employees and contractors who sign in with their own
    -- email. Clients never get an account. One owner delegates; everyone else
    -- carries a job title. Hourly rates are owner-only (contractors).
    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Team Member',
      kind TEXT NOT NULL DEFAULT 'employee',
      is_owner INTEGER NOT NULL DEFAULT 0,
      hourly_rate_cents INTEGER,
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'invited',
      session_version INTEGER NOT NULL DEFAULT 1,
      invite_token_hash TEXT,
      invite_expires_at TEXT,
      last_login_at TEXT,
      photo TEXT,
      photo_updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Delegated work (replaces ClickUp). Only the owner creates and assigns;
    -- a task goes to a team member, to an agent (agent_task_key links the
    -- Agents tab draft), or both. Clients never see these.
    CREATE TABLE IF NOT EXISTS work_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT,
      title TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'normal',
      assignee_id INTEGER,
      agent_task_key TEXT,
      page_path TEXT,
      due_date TEXT,
      estimate_minutes INTEGER,
      created_by INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS work_tasks_assignee ON work_tasks (assignee_id, status);
    CREATE INDEX IF NOT EXISTS work_tasks_client ON work_tasks (client_slug, status);

    -- An agent carrying a Work task out in the client's code (GitHub): one row
    -- per attempt. Round 2+ are "send back" rounds on the same branch and PR.
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_task_id INTEGER NOT NULL,
      client_slug TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      round INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'queued',
      feedback TEXT,
      gh_run_id INTEGER,
      gh_run_url TEXT,
      head_sha TEXT,
      changed_files INTEGER,
      pr_number INTEGER,
      pr_url TEXT,
      preview_url TEXT,
      summary TEXT,
      error TEXT,
      origin TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS agent_runs_task ON agent_runs (work_task_id, id);
    CREATE INDEX IF NOT EXISTS agent_runs_status ON agent_runs (status);

    -- The dashboard's own GitHub app (one row), made with GitHub's one-click
    -- manifest flow. Its private key and secrets are stored encrypted.
    CREATE TABLE IF NOT EXISTS github_app (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      app_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      client_id TEXT,
      html_url TEXT,
      owner_login TEXT,
      pem_enc TEXT NOT NULL,
      client_secret_enc TEXT,
      webhook_secret_enc TEXT,
      installation_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Time tracking: one row per stint on a task. ended_at is NULL while the
    -- timer runs; each person has at most one running timer. client_slug is
    -- copied in at the start so reports stay right if a task moves clients.
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      client_slug TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'timer',
      rate_cents INTEGER,
      edited_at TEXT,
      edited_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS time_entries_member ON time_entries (member_id, started_at);
    CREATE INDEX IF NOT EXISTS time_entries_task ON time_entries (task_id);
    CREATE INDEX IF NOT EXISTS time_entries_client ON time_entries (client_slug, started_at);

    -- People @mentioned in a task's comments: they're emailed, and can open
    -- that task even when it isn't assigned to them.
    CREATE TABLE IF NOT EXISTS work_task_mentions (
      task_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      comment_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, member_id, comment_id)
    );

    CREATE TABLE IF NOT EXISTS work_task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      author_id INTEGER,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: team headshots (team-accounts branch DBs)
  try {
    await db.execute("SELECT photo FROM team_members LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE team_members ADD COLUMN photo TEXT");
    await db.execute("ALTER TABLE team_members ADD COLUMN photo_updated_at TEXT");
  }

  // Migration: contractor rate snapshot on time entries (team-accounts branch DBs)
  try {
    await db.execute("SELECT rate_cents FROM time_entries LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE time_entries ADD COLUMN rate_cents INTEGER");
  }

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

  // Migration: the Slack channel a comment was posted to, so replies thread
  // there even after the client's channel changes.
  // Two cold requests can race here; the loser's "duplicate column" is fine.
  try {
    await db.execute("SELECT slack_channel FROM feedback LIMIT 1");
  } catch {
    await db.execute("ALTER TABLE feedback ADD COLUMN slack_channel TEXT").catch((err) => {
      if (!/duplicate column/i.test(String(err))) throw err;
    });
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
