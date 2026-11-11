import type { Feedback } from "./feedback";

// Posts client feedback to Slack. With SLACK_BOT_TOKEN each comment is one
// message and every reply or status change is threaded under it, in the
// client's own channel when one is set (Feedback tab) or SLACK_CHANNEL_ID
// otherwise. With only SLACK_WEBHOOK_URL, everything posts as separate
// messages to the webhook's channel. Without either, nothing is sent.

const DEVICE_LABEL: Record<string, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

export interface SlackThread { ts: string; channel: string }

export function slackConfigured(clientChannel?: string | null) {
  return !!((process.env.SLACK_BOT_TOKEN && (clientChannel || process.env.SLACK_CHANNEL_ID)) || process.env.SLACK_WEBHOOK_URL);
}

async function chatPost(channel: string, payload: Record<string, unknown>) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, unfurl_links: false, ...payload }),
  });
  return (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string };
}

async function post(payload: Record<string, unknown>, channel?: string | null): Promise<SlackThread | null> {
  try {
    const fallback = process.env.SLACK_CHANNEL_ID;
    const target = channel || fallback;
    if (process.env.SLACK_BOT_TOKEN && target) {
      let json = await chatPost(target, payload);
      // The bot isn't in the client's channel (or it was renamed): post to the
      // default channel rather than lose the message. Not for thread replies,
      // whose ts only exists in the original channel.
      if (!json.ok && target !== fallback && fallback && !payload.thread_ts) {
        console.error(`Slack error in ${target}:`, json.error);
        json = await chatPost(fallback, payload);
      }
      if (!json.ok) console.error("Slack error:", json.error);
      return json.ok && json.ts ? { ts: json.ts, channel: json.channel || target } : null;
    }
    if (process.env.SLACK_WEBHOOK_URL) {
      const { thread_ts: _thread, ...rest } = payload;
      void _thread;
      await fetch(process.env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rest) });
    }
  } catch (err) {
    console.error("Slack post failed:", err);
  }
  return null;
}

const quote = (s: string) => s.split("\n").map((l) => `>${l}`).join("\n").slice(0, 2800);

// The commenter's photo as a small image beside the context line.
const photo = (url: string | null | undefined, name: string) => (url ? [{ type: "image", image_url: url, alt_text: name }] : []);

// Returns where the message landed so replies can thread under it.
export async function notifyNewFeedback(
  f: Feedback,
  clientName: string,
  openUrl: string,
  opts: { channel?: string | null; photoUrl?: string | null } = {}
): Promise<SlackThread | null> {
  const where = `${DEVICE_LABEL[f.device] || f.device}${f.viewportWidth ? ` · ${f.viewportWidth}px` : ""}`;
  const title = f.kind === "approval"
    ? `✅ *${f.authorName}* approved *${f.pagePath}* on ${clientName}`
    : `💬 *${f.authorName}* left comment #${f.number} on *${clientName}* · \`${f.pagePath}\``;
  return post({
    text: `${f.authorName} on ${clientName}: ${f.body}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${title}\n${quote(f.body)}` } },
      {
        type: "context",
        elements: [
          ...photo(opts.photoUrl, f.authorName),
          { type: "mrkdwn", text: `${where}${f.browser ? ` · ${f.browser}` : ""} · <${f.pageUrl}|${f.pageUrl.replace(/^https?:\/\//, "")}>` },
        ],
      },
      {
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Open comment" }, url: openUrl, style: "primary" }],
      },
    ],
  }, opts.channel);
}

export async function notifyReply(
  thread: SlackThread | null,
  f: Feedback,
  clientName: string,
  author: string,
  body: string,
  openUrl: string,
  opts: { channel?: string | null; photoUrl?: string | null } = {}
) {
  await post({
    ...(thread ? { thread_ts: thread.ts } : {}),
    text: `${author} replied on ${clientName} #${f.number}: ${body}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `↩️ *${author}* replied${thread ? "" : ` on ${clientName} comment #${f.number}`}\n${quote(body)}` } },
      { type: "context", elements: [...photo(opts.photoUrl, author), { type: "mrkdwn", text: `<${openUrl}|Open comment>` }] },
    ],
  }, thread?.channel || opts.channel);
}

export async function notifyStatus(thread: SlackThread | null, f: Feedback, clientName: string, status: string, by: string, channel?: string | null) {
  const label = status === "resolved" ? "✅ resolved" : status === "in_progress" ? "🛠 marked in progress" : "↺ reopened";
  await post({
    ...(thread ? { thread_ts: thread.ts } : {}),
    text: `${by} ${label} ${clientName} #${f.number}`,
  }, thread?.channel || channel);
}

// "Send test to Slack" on the Feedback tab: posts to the channel this client's
// feedback would use and reports exactly what happened, so a wrong channel or
// a bot that wasn't invited shows up as a plain answer instead of silence.
export async function slackTest(clientName: string, clientChannel?: string | null) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = clientChannel || process.env.SLACK_CHANNEL_ID || "";
  const source = clientChannel ? "this client's channel" : "the default channel (SLACK_CHANNEL_ID)";
  if (!token) return { ok: false, channel, source, bot: null, channelName: null, error: "no_token", hint: "SLACK_BOT_TOKEN isn't set in Vercel." };
  if (!channel) return { ok: false, channel, source, bot: null, channelName: null, error: "no_channel", hint: "No channel is set: add SLACK_CHANNEL_ID in Vercel or a channel for this client." };

  const call = async (method: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Record<string, unknown> & { ok: boolean; error?: string };
  };
  const auth = await call("auth.test", {});
  const bot = auth.ok ? `${auth.user}` : null;
  // Needs channels:read; without it we just show the ID.
  const info = await call("conversations.info", { channel: channel.replace(/^#/, "") });
  const channelName = info.ok ? `#${(info.channel as { name?: string })?.name}` : channel.startsWith("#") ? channel : null;
  const post = auth.ok
    ? await call("chat.postMessage", { channel, text: `✅ MMG Pulse test: client feedback for ${clientName} will post here.` })
    : auth;

  const hints: Record<string, string> = {
    not_in_channel: `The bot${bot ? ` (@${bot})` : ""} isn't in this channel. Open ${channelName || `the channel with ID ${channel}`} in Slack and type /invite @${bot || "your-bot"}.`,
    channel_not_found: `Slack can't find channel ${channel}. It may be private (invite the bot first) or the ID is wrong.`,
    invalid_auth: "The Slack bot token isn't valid. Copy a fresh Bot User OAuth Token into SLACK_BOT_TOKEN in Vercel.",
    token_revoked: "The Slack bot token was revoked. Reinstall the app and update SLACK_BOT_TOKEN in Vercel.",
    account_inactive: "The Slack app was uninstalled. Reinstall it and update SLACK_BOT_TOKEN in Vercel.",
    missing_scope: "The Slack app needs the chat:write permission (OAuth & Permissions), then a reinstall.",
  };
  return {
    ok: post.ok,
    channel,
    source,
    bot,
    channelName,
    error: post.ok ? null : post.error || "unknown_error",
    hint: post.ok ? null : hints[post.error || ""] || `Slack said: ${post.error}.`,
  };
}
