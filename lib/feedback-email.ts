import { after } from "next/server";
import { getDb } from "./db";
import { getAllClients, type ClientConfig } from "./clients";
import { getReviewLink, listFeedback, type Feedback, type FeedbackStatus } from "./feedback";
import { photoPath } from "./feedback-photo";
import { getConnection, sendEmail } from "./google-oauth";

// Client feedback emails, sent from the connected Gmail account:
// - the team gets one digest of client activity (comments, approvals, client
//   replies and status changes), to FEEDBACK_DIGEST_TO or the Gmail account;
// - commenters get one email about the team's replies and status changes on
//   their threads, unless the client's Feedback tab turns that off.
// Nothing goes out the moment it happens: items wait in feedback_outbox until
// activity has been quiet for QUIET_MS (or the oldest has waited MAX_WAIT_MS),
// so a burst of comments or a round of fixes becomes one email.

export type OutboxAudience = "team" | "client";
export type OutboxEvent = "comment" | "approval" | "reply" | "status";

const QUIET_MS = 2 * 60_000;
const MAX_WAIT_MS = 10 * 60_000;
const SENDER = "MMG Studio";

interface OutboxRow {
  id: number;
  clientSlug: string;
  feedbackId: number;
  audience: OutboxAudience;
  event: OutboxEvent;
  actor: string;
  body: string | null;
  link: string;
  createdAt: string;
}

const toDate = (iso: string) => new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Queues an email and, once this request has answered, waits out the quiet
// period and sends whatever is due. The last item of a burst sends the batch.
export async function queueFeedbackEmail(item: {
  clientSlug: string;
  feedbackId: number;
  audience: OutboxAudience;
  event: OutboxEvent;
  actor: string;
  body?: string | null;
  link: string;
}) {
  const db = await getDb();
  await db.execute({
    sql: "INSERT INTO feedback_outbox (client_slug, feedback_id, audience, event, actor, body, link) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [item.clientSlug, item.feedbackId, item.audience, item.event, item.actor, item.body ?? null, item.link],
  });
  after(async () => {
    await sleep(QUIET_MS + 5_000);
    await flushFeedbackEmails().catch((err) => console.error("Feedback email flush failed:", err));
  });
}

// For pages that poll (the review page, the Feedback tab): a cheap backstop in
// case a queued sender was cut short. At most once a minute per instance.
let lastSweep = 0;
export function sweepFeedbackEmails() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  after(() => flushFeedbackEmails().catch((err) => console.error("Feedback email sweep failed:", err)));
}

// Sends every batch that's due (all of them with force). Returns how many
// emails went out.
export async function flushFeedbackEmails(opts: { force?: boolean } = {}) {
  const db = await getDb();
  // A sender that died mid-batch leaves its claim behind; free it up.
  await db.execute("UPDATE feedback_outbox SET claim = NULL, claimed_at = NULL WHERE sent_at IS NULL AND claim IS NOT NULL AND claimed_at < datetime('now', '-10 minutes')");
  // Never sent (say Gmail was disconnected for days): too stale to send now.
  await db.execute("UPDATE feedback_outbox SET sent_at = 'expired' WHERE sent_at IS NULL AND created_at < datetime('now', '-3 days')");

  const connection = await getConnection();
  if (!connection) return { sent: 0, reason: "Gmail isn't connected" };

  const res = await db.execute("SELECT * FROM feedback_outbox WHERE sent_at IS NULL AND claim IS NULL ORDER BY id");
  const rows: OutboxRow[] = res.rows.map((r) => ({
    id: Number(r.id),
    clientSlug: r.client_slug as string,
    feedbackId: Number(r.feedback_id),
    audience: r.audience as OutboxAudience,
    event: r.event as OutboxEvent,
    actor: r.actor as string,
    body: (r.body as string) || null,
    link: r.link as string,
    createdAt: r.created_at as string,
  }));
  if (rows.length === 0) return { sent: 0 };

  // One team digest across all clients; client emails batch per client.
  const groups = new Map<string, OutboxRow[]>();
  for (const r of rows) {
    const key = r.audience === "team" ? "team" : `client:${r.clientSlug}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }

  const clients = new Map((await getAllClients()).map((c) => [c.slug, c]));
  let sent = 0;
  for (const [key, items] of groups) {
    const now = Date.now();
    const newest = toDate(items[items.length - 1].createdAt).getTime();
    const oldest = toDate(items[0].createdAt).getTime();
    if (!opts.force && now - newest < QUIET_MS && now - oldest < MAX_WAIT_MS) continue;

    const claim = `${now}-${Math.random().toString(36).slice(2)}`;
    await db.execute({
      sql: `UPDATE feedback_outbox SET claim = ?, claimed_at = datetime('now')
            WHERE claim IS NULL AND sent_at IS NULL AND id IN (${items.map(() => "?").join(", ")})`,
      args: [claim, ...items.map((i) => i.id)],
    });
    const mine = await db.execute({ sql: "SELECT id FROM feedback_outbox WHERE claim = ?", args: [claim] });
    const claimed = new Set(mine.rows.map((r) => Number(r.id)));
    const batch = items.filter((i) => claimed.has(i.id));
    if (batch.length === 0) continue; // another sender got there first

    try {
      sent += key === "team"
        ? await sendTeamDigest(batch, clients, process.env.FEEDBACK_DIGEST_TO || connection.email)
        : await sendClientEmails(batch, clients.get(batch[0].clientSlug));
      await db.execute({ sql: "UPDATE feedback_outbox SET sent_at = datetime('now') WHERE claim = ?", args: [claim] });
    } catch (err) {
      console.error(`Feedback email (${key}) failed:`, err);
      await db.execute({ sql: "UPDATE feedback_outbox SET claim = NULL, claimed_at = NULL WHERE claim = ?", args: [claim] });
    }
  }
  return { sent };
}

// ---------------------------------------------------------------------------
// Building the emails

interface Item {
  row: OutboxRow;
  client: ClientConfig | undefined;
  f: Feedback | undefined;
  photoUrl: string | null;
}

// Joins outbox rows to their comments (number, page, photo) for one client.
async function itemsFor(rows: OutboxRow[], client: ClientConfig | undefined): Promise<Item[]> {
  const slug = rows[0].clientSlug;
  const [comments, token] = await Promise.all([listFeedback(slug), getReviewLink(slug, false)]);
  const byId = new Map(comments.map((c) => [c.id, c]));
  return rows.map((row) => {
    const f = byId.get(row.feedbackId);
    // The photo of whoever acted: the commenter for a new comment, else the
    // matching reply's author.
    const ref = row.event === "comment" || row.event === "approval"
      ? f?.authorPhoto
      : f?.replies.slice().reverse().find((r) => r.authorName === row.actor)?.authorPhoto;
    const origin = new URL(row.link).origin;
    // Commenters only ever hear about the team's activity: the MMG mark stands in for a photo.
    const fallback = row.audience === "client" ? `${origin}/mmg-icon.png` : null;
    return { row, client, f, photoUrl: ref && token ? `${origin}${photoPath(token, ref)}` : fallback };
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pageName = (path: string | undefined) => (!path || path === "/" ? "the homepage" : path);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const STATUS_WORDS: Record<FeedbackStatus, string> = { resolved: "resolved", in_progress: "in progress", open: "reopened" };

function headline(i: Item, forClient: boolean) {
  const n = i.f ? `#${i.f.number}` : "a comment";
  const page = pageName(i.f?.pagePath);
  switch (i.row.event) {
    case "comment": return `${i.row.actor} left comment ${n} on ${page}`;
    case "approval": return `${i.row.actor} approved ${page}`;
    case "reply": return forClient ? `${i.row.actor} replied to your comment on ${page}` : `${i.row.actor} replied on ${n} (${page})`;
    case "status": {
      const word = STATUS_WORDS[i.row.body as FeedbackStatus] || "updated";
      return forClient
        ? i.row.body === "in_progress" ? `${i.row.actor} is working on your comment on ${page}` : `Your comment on ${page} was ${word}`
        : `${i.row.actor} marked ${n} ${word}`;
    }
  }
}

function avatarHtml(name: string, photoUrl: string | null) {
  if (photoUrl) return `<img src="${esc(photoUrl)}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border-radius:16px;object-fit:cover">`;
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return `<div style="width:32px;height:32px;border-radius:16px;background:#E2F4F8;color:#01384C;font:600 12px/32px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;text-align:center">${esc(initials)}</div>`;
}

// For the client, the first update on a comment quotes it for context.
function itemHtml(i: Item, forClient: boolean, showContext = forClient) {
  const quoted = i.row.event === "reply" || i.row.event === "comment" ? i.row.body : null;
  const context = showContext && i.f ? `<div style="margin-top:6px;color:#6B7C88;font-size:13px">On: “${esc(clip(i.f.body, 140))}”</div>` : "";
  return `
  <tr><td style="padding:14px 0;border-top:1px solid #E6ECEF">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      <td width="44" valign="top">${avatarHtml(i.row.actor, i.photoUrl)}</td>
      <td valign="top" style="font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#001A2E">
        <div style="font-weight:600">${esc(headline(i, forClient))}</div>
        ${quoted ? `<div style="margin-top:6px;padding:8px 12px;border-left:3px solid #0CA4C3;background:#F4FAFB;white-space:pre-line">${esc(clip(quoted, 1200))}</div>` : ""}
        ${context}
        <div style="margin-top:8px"><a href="${esc(i.row.link)}" style="color:#0394B2;font-weight:600;text-decoration:none">${forClient ? "View on your site" : "Open comment"} →</a></div>
      </td>
    </tr></table>
  </td></tr>`;
}

function layout(origin: string, intro: string, body: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F3F6F8">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F3F6F8;padding:24px 12px"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;padding:24px 28px">
      <tr><td style="padding-bottom:14px"><img src="${esc(origin)}/mmg-icon.png" width="28" height="28" alt="MMG Studio" style="display:block;border-radius:6px"></td></tr>
      <tr><td style="padding-bottom:6px;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#001A2E">${intro}</td></tr>
      ${body}
      <tr><td style="padding-top:18px;border-top:1px solid #E6ECEF;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6B7C88">${footer}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function itemText(i: Item, forClient: boolean, showContext = forClient) {
  const quoted = i.row.event === "reply" || i.row.event === "comment" ? i.row.body : null;
  return [
    `- ${headline(i, forClient)}`,
    ...(quoted ? [`  "${clip(quoted, 1200).replace(/\n/g, "\n   ")}"`] : []),
    ...(showContext && i.f ? [`  On: "${clip(i.f.body, 140)}"`] : []),
    `  ${i.row.link}`,
  ].join("\n");
}

async function sendTeamDigest(rows: OutboxRow[], clients: Map<string, ClientConfig>, to: string) {
  const bySlug = new Map<string, OutboxRow[]>();
  for (const r of rows) bySlug.set(r.clientSlug, [...(bySlug.get(r.clientSlug) || []), r]);
  const sections: { name: string; items: Item[] }[] = [];
  for (const [slug, list] of bySlug) {
    const client = clients.get(slug);
    sections.push({ name: client?.name || slug, items: await itemsFor(list, client) });
  }
  const all = sections.flatMap((s) => s.items);
  const origin = new URL(rows[0].link).origin;

  const first = all[0];
  const subject = all.length === 1
    ? `${first.row.actor} on ${sections[0].name}: ${clip(first.row.event === "approval" ? `approved ${pageName(first.f?.pagePath)}` : first.row.event === "status" ? headline(first, false).replace(`${first.row.actor} `, "") : first.row.body || "", 70)}`
    : `${all.length} feedback updates from ${sections.length === 1 ? sections[0].name : `${sections.length} clients`}`;

  const body = sections.map((s) => `
    <tr><td style="padding:18px 0 4px;font:600 12px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#0394B2">${esc(s.name)}</td></tr>
    ${s.items.map((i) => itemHtml(i, false)).join("")}`).join("");
  const intro = all.length === 1 ? "New client feedback:" : `${all.length} new pieces of client feedback came in:`;
  const html = layout(origin, intro, body, "Sent by MMG Pulse. Reply in the review tool so the client is notified.");
  const text = [intro, ...sections.map((s) => [s.name.toUpperCase(), ...s.items.map((i) => itemText(i, false))].join("\n"))].join("\n\n");

  await sendEmail({ to, subject, text, html, fromName: "MMG Pulse" });
  return 1;
}

// Who's on each thread: the commenter and anyone else from the client side
// who replied with an email.
async function participants(feedbackIds: number[]) {
  const db = await getDb();
  const marks = feedbackIds.map(() => "?").join(", ");
  const res = await db.execute({
    sql: `SELECT id AS feedback_id, author_name, author_email FROM feedback WHERE id IN (${marks}) AND is_team = 0 AND author_email IS NOT NULL AND author_email != ''
          UNION ALL
          SELECT feedback_id, author_name, author_email FROM feedback_replies WHERE feedback_id IN (${marks}) AND is_team = 0 AND author_email IS NOT NULL AND author_email != ''`,
    args: [...feedbackIds, ...feedbackIds],
  });
  const byEmail = new Map<string, { email: string; name: string; feedbackIds: Set<number> }>();
  for (const r of res.rows) {
    const email = String(r.author_email).trim();
    if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(email)) continue;
    const key = email.toLowerCase();
    const entry = byEmail.get(key) || { email, name: String(r.author_name), feedbackIds: new Set<number>() };
    entry.feedbackIds.add(Number(r.feedback_id));
    byEmail.set(key, entry);
  }
  return [...byEmail.values()];
}

async function sendClientEmails(rows: OutboxRow[], client: ClientConfig | undefined) {
  if (client?.integrations.feedbackAlerts?.emailClients === false) return 0;
  const items = await itemsFor(rows, client);
  const people = await participants([...new Set(rows.map((r) => r.feedbackId))]);
  const origin = new URL(rows[0].link).origin;
  const site = client?.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "") || "your site";
  let sent = 0;
  let failed: unknown = null;

  // One person's address failing shouldn't resend everyone else's email, so
  // the batch only counts as failed when nobody got theirs.
  for (const person of people) {
    const mine = items.filter((i) => person.feedbackIds.has(i.row.feedbackId));
    if (mine.length === 0) continue;
    const firstOnComment = (i: Item) => mine.find((m) => m.row.feedbackId === i.row.feedbackId) === i;
    const firstName = person.name.trim().split(/\s+/)[0];
    const subject = mine.length === 1 ? headline(mine[0], true) : `${mine.length} updates on your website feedback`;
    const intro = `Hi${firstName ? ` ${esc(firstName)}` : ""},<br>${mine.length === 1 ? "There's an update on feedback you left" : "Here's what's changed on feedback you left"} on ${esc(site)}:`;
    const html = layout(origin, intro, mine.map((i) => itemHtml(i, true, firstOnComment(i))).join(""), `You're getting this because you left feedback on ${esc(site)} with ${SENDER}. Reply to this email or on the comment itself.`);
    const text = [`Hi${firstName ? ` ${firstName}` : ""},`, "", `${mine.length === 1 ? "There's an update on feedback you left" : "Here's what's changed on feedback you left"} on ${site}:`, "", ...mine.map((i) => itemText(i, true, firstOnComment(i)))].join("\n");
    try {
      await sendEmail({ to: person.email, subject, text, html, fromName: SENDER });
      sent++;
    } catch (err) {
      console.error(`Feedback email to ${person.email} failed:`, err);
      failed = err;
    }
  }
  if (failed && sent === 0) throw failed;
  return sent;
}
