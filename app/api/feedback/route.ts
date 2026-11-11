import { NextRequest, NextResponse } from "next/server";
import { getClient, updateClient } from "@/lib/clients";
import { getReviewLink, listFeedback, rotateReviewLink } from "@/lib/feedback";
import { sweepFeedbackEmails } from "@/lib/feedback-email";
import { getConnection } from "@/lib/google-oauth";
import { slackConfigured, slackTest } from "@/lib/slack";

// Team-only (behind the dashboard password): a client's review link, its
// feedback queue and where feedback notifications go, for the Feedback tab.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const client = slug ? await getClient(slug) : null;
  if (!slug || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const [token, comments, gmail] = await Promise.all([getReviewLink(slug), listFeedback(slug), getConnection()]);
  sweepFeedbackEmails();
  const alerts = client.integrations.feedbackAlerts;
  return NextResponse.json({
    link: `${req.nextUrl.origin}/review/${token}`,
    token,
    slack: slackConfigured(alerts?.slackChannel),
    notify: {
      slackChannel: alerts?.slackChannel || "",
      defaultChannel: !!process.env.SLACK_CHANNEL_ID,
      botToken: !!process.env.SLACK_BOT_TOKEN,
      emailClients: alerts?.emailClients !== false,
      gmail: gmail?.email || null,
      digestTo: process.env.FEEDBACK_DIGEST_TO || gmail?.email || null,
    },
    comments,
  });
}

// { client, rotate: true } replaces the link; the old one stops working.
// { client, notify: { slackChannel, emailClients } } saves notification settings.
// { client, testSlack: true } posts a test message and reports what Slack said.
export async function POST(req: NextRequest) {
  const { client: slug, rotate, notify, testSlack } = (await req.json()) as {
    client?: string;
    rotate?: boolean;
    notify?: { slackChannel?: string; emailClients?: boolean };
    testSlack?: boolean;
  };
  const client = slug ? await getClient(slug) : null;
  if (!slug || !client) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  if (testSlack) return NextResponse.json(await slackTest(client.name, client.integrations.feedbackAlerts?.slackChannel));
  if (notify) {
    const slackChannel = (notify.slackChannel || "").trim().slice(0, 80);
    if (slackChannel && !/^(#?[a-z0-9][a-z0-9._-]*|[CG][A-Z0-9]{6,})$/.test(slackChannel)) {
      return NextResponse.json({ error: "Use a channel name like #client-acme or a channel ID like C0123ABCD." }, { status: 400 });
    }
    await updateClient(slug, { integrations: { feedbackAlerts: { slackChannel: slackChannel || undefined, emailClients: notify.emailClients !== false } } });
    return NextResponse.json({ ok: true });
  }
  if (!rotate) return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
  const token = await rotateReviewLink(slug);
  return NextResponse.json({ link: `${req.nextUrl.origin}/review/${token}`, token });
}
