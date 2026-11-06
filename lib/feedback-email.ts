import { createHash } from "crypto";
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
// Who the emails come from, shown at the top with a small headshot
// (public/email/andy.png). Team updates to clients carry the same photo.
const PERSON = { name: "Andy Milligan", role: "MMG Studio", photo: "/email/andy.png" };

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

// The client's logo as an image email apps will show (see the logo route).
function logoUrl(origin: string, token: string | null, client: ClientConfig | undefined) {
  const icon = client?.iconUrl;
  if (!icon || !token) return null;
  if (/^https?:\/\//.test(icon)) return icon;
  if (icon.startsWith("/") && !icon.endsWith(".svg")) return `${origin}${icon}`;
  return `${origin}/api/review/${token}/logo?v=${createHash("sha1").update(icon).digest("hex").slice(0, 10)}`;
}

// Joins outbox rows to their comments (number, page, photo) for one client.
async function itemsFor(rows: OutboxRow[], client: ClientConfig | undefined) {
  const slug = rows[0].clientSlug;
  const [comments, token] = await Promise.all([listFeedback(slug), getReviewLink(slug, false)]);
  const byId = new Map(comments.map((c) => [c.id, c]));
  const origin = new URL(rows[0].link).origin;
  const items: Item[] = rows.map((row) => {
    const f = byId.get(row.feedbackId);
    // The photo of whoever acted: the commenter for a new comment, else the
    // matching reply's author.
    const ref = row.event === "comment" || row.event === "approval"
      ? f?.authorPhoto
      : f?.replies.slice().reverse().find((r) => r.authorName === row.actor)?.authorPhoto;
    // Commenters only ever hear about the team's activity: Andy's photo stands in.
    const fallback = row.audience === "client" ? `${origin}${PERSON.photo}` : null;
    return { row, client, f, photoUrl: ref && token ? `${origin}${photoPath(token, ref)}` : fallback };
  });
  return { items, logo: logoUrl(origin, token, client) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pageName = (path: string | undefined) => (!path || path === "/" ? "the homepage" : path);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const STATUS_WORDS: Record<FeedbackStatus, string> = { resolved: "resolved", in_progress: "in progress", open: "reopened" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const C = { ink: "#001A2E", muted: "#5F7280", line: "#E6ECEF", teal: "#0394B2", tint: "#F2F9FB", page: "#F3F6F8" };

function headline(i: Item, forClient: boolean) {
  const n = i.f ? `#${i.f.number}` : "a comment";
  const page = pageName(i.f?.pagePath);
  switch (i.row.event) {
    case "comment": return `${i.row.actor} left ${i.f ? `comment ${n}` : "a comment"} on ${page}`;
    case "approval": return `${i.row.actor} approved ${page}`;
    case "reply": return forClient ? `${i.row.actor} replied to your comment on ${page}` : `${i.row.actor} replied on ${i.f ? `${n} (${page})` : page}`;
    case "status": {
      const word = STATUS_WORDS[i.row.body as FeedbackStatus] || "updated";
      return forClient
        ? i.row.body === "in_progress" ? `${i.row.actor} is working on your comment on ${page}` : `Your comment on ${page} was ${word}`
        : `${i.row.actor} marked ${n} ${word}`;
    }
  }
}

function avatarHtml(name: string, photoUrl: string | null, size = 32) {
  if (photoUrl) return `<img src="${esc(photoUrl)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border-radius:${size / 2}px;border:0">`;
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return `<div style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:#E2F4F8;color:#01384C;font:600 12px/${size}px ${FONT};text-align:center">${esc(initials)}</div>`;
}

function logoHtml(url: string | null, name: string, size: number) {
  return url ? `<img src="${esc(url)}" width="${size}" height="${size}" alt="${esc(name)}" style="display:block;width:${size}px;height:${size}px;border-radius:${Math.round(size / 4)}px;border:0">` : "";
}

// A real button: an outlined link with the arrow as an image, since email
// apps drop inline SVG and render "→" in whatever font they like.
function buttonHtml(origin: string, href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>
    <td style="border:1px solid #CFE6EC;border-radius:8px;background:#ffffff">
      <a href="${esc(href)}" style="display:inline-block;padding:7px 12px;font:600 13px/18px ${FONT};color:${C.teal};text-decoration:none">${esc(label)}&nbsp;<img src="${esc(origin)}/email/arrow.png" width="14" height="14" alt="" style="display:inline-block;width:14px;height:14px;vertical-align:-3px;border:0"></a>
    </td></tr></table>`;
}

const STATUS_PILL: Record<string, { label: string; bg: string; fg: string }> = {
  resolved: { label: "Resolved", bg: "#E7F6EE", fg: "#047857" },
  in_progress: { label: "In progress", bg: "#FEF3E2", fg: "#B45309" },
  open: { label: "Reopened", bg: "#E6F4F8", fg: "#01384C" },
};

// For the client, the first update on a comment quotes it for context.
function itemHtml(origin: string, i: Item, forClient: boolean, showContext = forClient) {
  const quoted = i.row.event === "reply" || i.row.event === "comment" ? i.row.body : null;
  const pill = i.row.event === "status" ? STATUS_PILL[i.row.body || ""] : null;
  const context = showContext && i.f
    ? `<div style="margin-top:8px;font:13px/1.5 ${FONT};color:${C.muted}">Your comment: “${esc(clip(i.f.body, 140))}”</div>`
    : "";
  return `
  <tr><td style="padding:18px 0;border-top:1px solid ${C.line}">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      <td width="46" valign="top">${avatarHtml(i.row.actor, i.photoUrl)}</td>
      <td valign="top" style="font:14px/1.5 ${FONT};color:${C.ink}">
        <div style="font-weight:600">${esc(headline(i, forClient))}${pill ? ` <span style="display:inline-block;margin-left:4px;padding:1px 8px;border-radius:10px;background:${pill.bg};color:${pill.fg};font-size:11px;font-weight:600;vertical-align:1px">${pill.label}</span>` : ""}</div>
        ${quoted ? `<div style="margin-top:8px;padding:10px 14px;border-left:3px solid #0CA4C3;border-radius:0 6px 6px 0;background:${C.tint};white-space:pre-line">${esc(clip(quoted, 1200))}</div>` : ""}
        ${context}
        ${buttonHtml(origin, i.row.link, forClient ? "View on your site" : "Open comment")}
      </td>
    </tr></table>
  </td></tr>`;
}

// Andy's headshot and name at the top; the client's logo on the right of
// emails that go to that client.
function layout(origin: string, opts: { title: string; intro: string; body: string; footer: string; brand?: { logo: string | null; name: string; site: string } }) {
  const brand = opts.brand
    ? `<td align="right" valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="padding-right:10px;text-align:right;font:12px/1.35 ${FONT};color:${C.muted}"><div style="font-weight:600;color:${C.ink}">${esc(opts.brand.name)}</div>${esc(opts.brand.site)}</td>
          ${opts.brand.logo ? `<td valign="middle">${logoHtml(opts.brand.logo, opts.brand.name, 32)}</td>` : ""}
        </tr></table>
      </td>`
    : "";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.page};padding:28px 12px"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid ${C.line};border-radius:14px">
      <tr><td style="padding:20px 28px;border-bottom:1px solid ${C.line}">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          <td valign="middle">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td valign="middle" style="padding-right:12px"><img src="${esc(origin)}${PERSON.photo}" width="40" height="40" alt="${esc(PERSON.name)}" style="display:block;width:40px;height:40px;border-radius:20px;border:0"></td>
              <td valign="middle" style="font:13px/1.35 ${FONT};color:${C.muted}"><div style="font-size:14px;font-weight:600;color:${C.ink}">${esc(PERSON.name)}</div>${esc(PERSON.role)}</td>
            </tr></table>
          </td>
          ${brand}
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 28px 6px">
        <div style="font:600 20px/1.3 ${FONT};color:${C.ink}">${esc(opts.title)}</div>
        <div style="margin-top:6px;font:14px/1.55 ${FONT};color:${C.muted}">${opts.intro}</div>
      </td></tr>
      <tr><td style="padding:10px 28px 4px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${opts.body}</table></td></tr>
      <tr><td style="padding:16px 28px 22px;border-top:1px solid ${C.line};font:12px/1.55 ${FONT};color:${C.muted}">${opts.footer}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function itemText(i: Item, forClient: boolean, showContext = forClient) {
  const quoted = i.row.event === "reply" || i.row.event === "comment" ? i.row.body : null;
  return [
    `- ${headline(i, forClient)}`,
    ...(quoted ? [`  "${clip(quoted, 1200).replace(/\n/g, "\n   ")}"`] : []),
    ...(showContext && i.f ? [`  Your comment: "${clip(i.f.body, 140)}"`] : []),
    `  ${i.row.link}`,
  ].join("\n");
}

type Section = { client: ClientConfig | undefined; name: string; items: Item[]; logo: string | null };

function buildTeamDigest(sections: Section[], origin: string) {
  const all = sections.flatMap((s) => s.items);
  const first = all[0];
  const subject = all.length === 1
    ? `${first.row.actor} on ${sections[0].name}: ${clip(first.row.event === "approval" ? `approved ${pageName(first.f?.pagePath)}` : first.row.event === "status" ? headline(first, false).replace(`${first.row.actor} `, "") : first.row.body || "", 70)}`
    : `${all.length} feedback updates from ${sections.length === 1 ? sections[0].name : `${sections.length} clients`}`;

  // Each client's section opens with its logo and name.
  const body = sections.map((s) => `
    <tr><td style="padding:16px 0 12px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        ${s.logo ? `<td valign="middle" style="padding-right:10px">${logoHtml(s.logo, s.name, 24)}</td>` : ""}
        <td valign="middle" style="font:600 12px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.teal}">${esc(s.name)}</td>
      </tr></table>
    </td></tr>
    ${s.items.map((i) => itemHtml(origin, i, false)).join("")}`).join("");
  const title = all.length === 1 ? "New client feedback" : `${all.length} new pieces of client feedback`;
  const intro = sections.length === 1 ? `From ${esc(sections[0].name)} since the last update.` : `From ${sections.length} clients since the last update.`;
  const html = layout(origin, { title, intro, body, footer: "Sent by MMG Pulse. Reply in the review tool so the client gets an email too." });
  const text = [title, ...sections.map((s) => [s.name.toUpperCase(), ...s.items.map((i) => itemText(i, false))].join("\n"))].join("\n\n");
  return { subject, html, text };
}

function buildClientEmail(person: { name: string }, mine: Item[], client: ClientConfig | undefined, logo: string | null, origin: string) {
  const site = client?.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "") || "your site";
  const firstOnComment = (i: Item) => mine.find((m) => m.row.feedbackId === i.row.feedbackId) === i;
  const firstName = person.name.trim().split(/\s+/)[0];
  const subject = mine.length === 1 ? headline(mine[0], true) : `${mine.length} updates on your website feedback`;
  const title = mine.length === 1 ? "An update on your feedback" : `${mine.length} updates on your feedback`;
  const lead = mine.length === 1 ? "There's an update on feedback you left" : "Here's what's changed on feedback you left";
  const intro = `Hi${firstName ? ` ${esc(firstName)}` : ""}, ${lead.charAt(0).toLowerCase()}${lead.slice(1)} on ${esc(site)}.`;
  const html = layout(origin, {
    title,
    intro,
    body: mine.map((i) => itemHtml(origin, i, true, firstOnComment(i))).join(""),
    footer: `You're getting this because you left feedback on ${esc(site)} with ${SENDER}. Reply to this email or on the comment itself.`,
    brand: { logo, name: client?.name || site, site },
  });
  const text = [`Hi${firstName ? ` ${firstName}` : ""},`, "", `${lead} on ${site}:`, "", ...mine.map((i) => itemText(i, true, firstOnComment(i))), "", `${PERSON.name}, ${PERSON.role}`].join("\n");
  return { subject, html, text };
}

async function sendTeamDigest(rows: OutboxRow[], clients: Map<string, ClientConfig>, to: string) {
  const bySlug = new Map<string, OutboxRow[]>();
  for (const r of rows) bySlug.set(r.clientSlug, [...(bySlug.get(r.clientSlug) || []), r]);
  const sections: Section[] = [];
  for (const [slug, list] of bySlug) {
    const client = clients.get(slug);
    const { items, logo } = await itemsFor(list, client);
    sections.push({ client, name: client?.name || slug, items, logo });
  }
  const email = buildTeamDigest(sections, new URL(rows[0].link).origin);
  await sendEmail({ to, ...email, fromName: "MMG Pulse" });
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
  const { items, logo } = await itemsFor(rows, client);
  const people = await participants([...new Set(rows.map((r) => r.feedbackId))]);
  const origin = new URL(rows[0].link).origin;
  let sent = 0;
  let failed: unknown = null;

  // One person's address failing shouldn't resend everyone else's email, so
  // the batch only counts as failed when nobody got theirs.
  for (const person of people) {
    const mine = items.filter((i) => person.feedbackIds.has(i.row.feedbackId));
    if (mine.length === 0) continue;
    try {
      await sendEmail({ to: person.email, ...buildClientEmail(person, mine, client, logo, origin), fromName: SENDER });
      sent++;
    } catch (err) {
      console.error(`Feedback email to ${person.email} failed:`, err);
      failed = err;
    }
  }
  if (failed && sent === 0) throw failed;
  return sent;
}

// Both emails filled with sample activity on a client's latest comment, for
// checking the design (team-only route /api/feedback/email-preview).
export async function previewFeedbackEmail(client: ClientConfig, kind: "team" | "client", origin: string) {
  const [comments, token] = await Promise.all([listFeedback(client.slug), getReviewLink(client.slug)]);
  const latest = comments.filter((c) => c.kind === "comment" && !c.isTeam).at(-1) || comments.filter((c) => c.kind === "comment").at(-1);
  const link = `${origin}/review/${token}${latest ? `?c=${latest.id}` : ""}`;
  const row = (audience: OutboxAudience, event: OutboxEvent, actor: string, body: string | null): OutboxRow => ({
    id: 0, clientSlug: client.slug, feedbackId: latest?.id ?? 0, audience, event, actor, body, link, createdAt: new Date().toISOString(),
  });
  const commenter = latest?.authorName || "Jane Cooper";
  const rows = kind === "team"
    ? [row("team", "comment", commenter, latest?.body || "Can we make this headline a bit shorter?"), row("team", "approval", commenter, null)]
    : [row("client", "reply", "MMG Studio", "Good call. We trimmed it to one line, take a look."), row("client", "status", "MMG Studio", "resolved")];
  const { items, logo } = await itemsFor(rows, client);
  return kind === "team"
    ? buildTeamDigest([{ client, name: client.name, items, logo }], origin)
    : buildClientEmail({ name: commenter }, items, client, logo, origin);
}
