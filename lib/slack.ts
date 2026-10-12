import type { Feedback } from "./feedback";

// Posts client feedback to Slack. With SLACK_BOT_TOKEN + SLACK_CHANNEL_ID each
// comment is one message and every reply or status change is threaded under
// it. With only SLACK_WEBHOOK_URL, everything posts as separate messages.
// Without either, nothing is sent.

const DEVICE_LABEL: Record<string, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

export function slackConfigured() {
  return !!((process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) || process.env.SLACK_WEBHOOK_URL);
}

async function post(payload: Record<string, unknown>): Promise<string | null> {
  try {
    if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: process.env.SLACK_CHANNEL_ID, unfurl_links: false, ...payload }),
      });
      const json = (await res.json()) as { ok: boolean; ts?: string; error?: string };
      if (!json.ok) console.error("Slack error:", json.error);
      return json.ok ? json.ts || null : null;
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

// Returns the message ts so replies can thread under it.
export async function notifyNewFeedback(f: Feedback, clientName: string, openUrl: string): Promise<string | null> {
  const where = `${DEVICE_LABEL[f.device] || f.device}${f.viewportWidth ? ` · ${f.viewportWidth}px` : ""}`;
  const title = f.kind === "approval"
    ? `✅ *${f.authorName}* approved *${f.pagePath}* on ${clientName}`
    : `💬 *${f.authorName}* left comment #${f.number} on *${clientName}* · \`${f.pagePath}\``;
  return post({
    text: `${f.authorName} on ${clientName}: ${f.body}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${title}\n${quote(f.body)}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `${where}${f.browser ? ` · ${f.browser}` : ""} · <${f.pageUrl}|${f.pageUrl.replace(/^https?:\/\//, "")}>` }] },
      {
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Open comment" }, url: openUrl, style: "primary" }],
      },
    ],
  });
}

export async function notifyReply(threadTs: string | null, f: Feedback, clientName: string, author: string, body: string, openUrl: string) {
  await post({
    ...(threadTs ? { thread_ts: threadTs } : {}),
    text: `${author} replied on ${clientName} #${f.number}: ${body}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `↩️ *${author}* replied${threadTs ? "" : ` on ${clientName} comment #${f.number}`}\n${quote(body)}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `<${openUrl}|Open comment>` }] },
    ],
  });
}

export async function notifyStatus(threadTs: string | null, f: Feedback, clientName: string, status: string, by: string) {
  const label = status === "resolved" ? "✅ resolved" : status === "in_progress" ? "🛠 marked in progress" : "↺ reopened";
  await post({
    ...(threadTs ? { thread_ts: threadTs } : {}),
    text: `${by} ${label} ${clientName} #${f.number}`,
  });
}
