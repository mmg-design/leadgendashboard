import { getDb } from "./db";
import { getClient, type ClientConfig } from "./clients";

// Website review tool: private share links and the comments clients pin on
// their live site (shown through the /proxy route, so nothing is installed on
// the client's site).

export type FeedbackStatus = "open" | "in_progress" | "resolved";
export type Device = "desktop" | "tablet" | "mobile";

// Where a comment sits on the page. The selector finds the element again;
// the offsets place the pin inside it; doc coords are the fallback when the
// element has changed since.
export interface Anchor {
  selector: string;
  text: string;
  offsetX: number; // 0-1 across the element
  offsetY: number; // 0-1 down the element
  docX: number;
  docY: number;
}

export interface Reply {
  id: number;
  body: string;
  authorName: string;
  isTeam: boolean;
  // Profile photo, as "<id>?v=<version>" under /api/review/<token>/avatar/.
  authorPhoto: string | null;
  createdAt: string;
}

export interface Feedback {
  id: number;
  number: number; // per-client running number shown on the pin
  clientSlug: string;
  kind: "comment" | "approval";
  pageUrl: string;
  pagePath: string;
  pageTitle: string | null;
  device: Device;
  viewportWidth: number | null;
  anchor: Anchor | null;
  body: string;
  authorName: string;
  authorEmail: string | null;
  isTeam: boolean;
  authorPhoto: string | null;
  browser: string | null;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
}

const STATUSES: FeedbackStatus[] = ["open", "in_progress", "resolved"];
export const isStatus = (s: unknown): s is FeedbackStatus => STATUSES.includes(s as FeedbackStatus);

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Buffer.from(bytes).toString("base64url");
}

export async function getReviewLink(slug: string, create = true): Promise<string | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT token FROM review_links WHERE client_slug = ?", args: [slug] });
  if (res.rows[0]) return res.rows[0].token as string;
  if (!create) return null;
  const token = randomToken();
  await db.execute({ sql: "INSERT INTO review_links (client_slug, token) VALUES (?, ?)", args: [slug, token] });
  return token;
}

// Replaces the link; the old one stops working immediately.
export async function rotateReviewLink(slug: string): Promise<string> {
  const db = await getDb();
  const token = randomToken();
  await db.execute({
    sql: `INSERT INTO review_links (client_slug, token) VALUES (?, ?)
          ON CONFLICT(client_slug) DO UPDATE SET token = excluded.token, created_at = datetime('now')`,
    args: [slug, token],
  });
  return token;
}

export async function clientForToken(token: string): Promise<ClientConfig | null> {
  if (!token || token.length < 16) return null;
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT client_slug FROM review_links WHERE token = ?", args: [token] });
  if (!res.rows[0]) return null;
  return getClient(res.rows[0].client_slug as string);
}

// Photos are looked up by email first, then by name.
const emailKey = (email: unknown) => (typeof email === "string" && email.trim() ? `email:${email.trim().toLowerCase()}` : null);
const nameKey = (name: unknown) => (typeof name === "string" && name.trim() ? `name:${name.trim().toLowerCase()}` : null);

async function photoRefs(slug: string) {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT id, author_key, updated_at FROM feedback_avatars WHERE client_slug = ?", args: [slug] });
  const refs = new Map(res.rows.map((r) => [r.author_key as string, `${r.id}?v=${encodeURIComponent(String(r.updated_at))}`]));
  return (email: unknown, name: unknown) => refs.get(emailKey(email) || "") || refs.get(nameKey(name) || "") || null;
}

const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_PHOTO_CHARS = 80_000; // the browser sends ~128px JPEGs, a few KB

// Saves a commenter's photo under their email and name. Unchanged photos keep
// their version so browsers keep the cached copy.
export async function savePhoto(slug: string, who: { name: string; email?: string | null }, image: string) {
  if (image.length > MAX_PHOTO_CHARS || !PHOTO_RE.test(image)) return false;
  const keys = [emailKey(who.email), nameKey(who.name)].filter((k): k is string => !!k);
  const db = await getDb();
  for (const key of keys) {
    await db.execute({
      sql: `INSERT INTO feedback_avatars (client_slug, author_key, image) VALUES (?, ?, ?)
            ON CONFLICT(client_slug, author_key) DO UPDATE SET image = excluded.image, updated_at = datetime('now')
            WHERE feedback_avatars.image != excluded.image`,
      args: [slug, key, image],
    });
  }
  return keys.length > 0;
}

export async function removePhoto(slug: string, who: { name: string; email?: string | null }) {
  const keys = [emailKey(who.email), nameKey(who.name)].filter((k): k is string => !!k);
  if (keys.length === 0) return;
  const db = await getDb();
  await db.execute({ sql: `DELETE FROM feedback_avatars WHERE client_slug = ? AND author_key IN (${keys.map(() => "?").join(", ")})`, args: [slug, ...keys] });
}

export async function getPhoto(slug: string, id: number): Promise<{ type: string; bytes: Buffer } | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT image FROM feedback_avatars WHERE id = ? AND client_slug = ?", args: [id, slug] });
  const m = (res.rows[0]?.image as string | undefined)?.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  return m ? { type: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}

function rowToFeedback(row: Record<string, unknown>, number: number, replies: Reply[], authorPhoto: string | null): Feedback {
  return {
    id: Number(row.id),
    number,
    clientSlug: row.client_slug as string,
    kind: (row.kind as Feedback["kind"]) || "comment",
    pageUrl: row.page_url as string,
    pagePath: row.page_path as string,
    pageTitle: (row.page_title as string) || null,
    device: row.device as Device,
    viewportWidth: row.viewport_width != null ? Number(row.viewport_width) : null,
    anchor: row.anchor ? JSON.parse(row.anchor as string) : null,
    body: row.body as string,
    authorName: row.author_name as string,
    authorEmail: (row.author_email as string) || null,
    isTeam: Number(row.is_team) === 1,
    authorPhoto,
    browser: (row.browser as string) || null,
    status: row.status as FeedbackStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    replies,
  };
}

export async function listFeedback(slug: string): Promise<Feedback[]> {
  const db = await getDb();
  const [items, replies, photoFor] = await Promise.all([
    db.execute({ sql: "SELECT * FROM feedback WHERE client_slug = ? ORDER BY id", args: [slug] }),
    db.execute({
      sql: `SELECT r.* FROM feedback_replies r JOIN feedback f ON f.id = r.feedback_id WHERE f.client_slug = ? ORDER BY r.id`,
      args: [slug],
    }),
    photoRefs(slug),
  ]);
  const byFeedback = new Map<number, Reply[]>();
  for (const r of replies.rows) {
    const list = byFeedback.get(Number(r.feedback_id)) || [];
    list.push({
      id: Number(r.id),
      body: r.body as string,
      authorName: r.author_name as string,
      isTeam: Number(r.is_team) === 1,
      authorPhoto: photoFor(r.author_email, r.author_name),
      createdAt: r.created_at as string,
    });
    byFeedback.set(Number(r.feedback_id), list);
  }
  return items.rows.map((row, i) =>
    rowToFeedback(row as Record<string, unknown>, i + 1, byFeedback.get(Number(row.id)) || [], photoFor(row.author_email, row.author_name))
  );
}

export async function getFeedback(slug: string, id: number): Promise<Feedback | null> {
  return (await listFeedback(slug)).find((f) => f.id === id) || null;
}

export async function createFeedback(
  slug: string,
  input: {
    kind?: "comment" | "approval";
    pageUrl: string;
    pagePath: string;
    pageTitle?: string | null;
    device: Device;
    viewportWidth?: number | null;
    anchor?: Anchor | null;
    body: string;
    authorName: string;
    authorEmail?: string | null;
    isTeam?: boolean;
    browser?: string | null;
  }
): Promise<number> {
  const db = await getDb();
  const res = await db.execute({
    sql: `INSERT INTO feedback (client_slug, kind, page_url, page_path, page_title, device, viewport_width, anchor, body,
            author_name, author_email, is_team, browser, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      slug,
      input.kind || "comment",
      input.pageUrl,
      input.pagePath,
      input.pageTitle || null,
      input.device,
      input.viewportWidth ?? null,
      input.anchor ? JSON.stringify(input.anchor) : null,
      input.body,
      input.authorName,
      input.authorEmail || null,
      input.isTeam ? 1 : 0,
      input.browser || null,
      // Approvals are a sign-off, not a to-do.
      input.kind === "approval" ? "resolved" : "open",
    ],
  });
  return Number(res.lastInsertRowid);
}

export async function addReply(feedbackId: number, input: { body: string; authorName: string; authorEmail?: string | null; isTeam?: boolean }) {
  const db = await getDb();
  await db.execute({
    sql: "INSERT INTO feedback_replies (feedback_id, body, author_name, author_email, is_team) VALUES (?, ?, ?, ?, ?)",
    args: [feedbackId, input.body, input.authorName, input.authorEmail || null, input.isTeam ? 1 : 0],
  });
  await db.execute({ sql: "UPDATE feedback SET updated_at = datetime('now') WHERE id = ?", args: [feedbackId] });
}

export async function setFeedbackStatus(feedbackId: number, status: FeedbackStatus) {
  const db = await getDb();
  await db.execute({ sql: "UPDATE feedback SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [status, feedbackId] });
}

export async function setSlackThread(feedbackId: number, thread: { ts: string; channel: string }) {
  const db = await getDb();
  await db.execute({ sql: "UPDATE feedback SET slack_ts = ?, slack_channel = ? WHERE id = ?", args: [thread.ts, thread.channel, feedbackId] });
}

// Comments posted before per-client channels all went to SLACK_CHANNEL_ID.
export async function slackThreadFor(feedbackId: number): Promise<{ ts: string; channel: string } | null> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT slack_ts, slack_channel FROM feedback WHERE id = ?", args: [feedbackId] });
  const ts = res.rows[0]?.slack_ts as string | undefined;
  return ts ? { ts, channel: (res.rows[0]?.slack_channel as string) || process.env.SLACK_CHANNEL_ID || "" } : null;
}

export async function openFeedbackCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const res = await db.execute(
    "SELECT client_slug, COUNT(*) AS n FROM feedback WHERE status != 'resolved' AND kind = 'comment' GROUP BY client_slug"
  );
  return Object.fromEntries(res.rows.map((r) => [r.client_slug as string, Number(r.n)]));
}

export function siteOrigin(domain: string) {
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

// The client's own hosts (with and without www), the only pages the proxy shows.
export function isClientHost(hostname: string, domain: string) {
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return bare(hostname) === bare(domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
}
