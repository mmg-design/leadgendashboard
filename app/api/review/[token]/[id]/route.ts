import { NextRequest, NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE, isTeamSession } from "@/lib/dashboard-auth";
import { addReply, clientForToken, getFeedback, isStatus, savePhoto, setFeedbackStatus, slackThreadFor } from "@/lib/feedback";
import { photoPath } from "@/lib/feedback-photo";
import { queueFeedbackEmail } from "@/lib/feedback-email";
import { notifyReply, notifyStatus } from "@/lib/slack";
import { recordEvent } from "@/lib/site-events";

// Reply to a comment, or change its status (open / in progress / resolved).
// Team activity is emailed to the commenters; client activity goes in the
// team's digest.
export const maxDuration = 300;

type Params = { params: Promise<{ token: string; id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { token, id: rawId } = await params;
  const client = await clientForToken(token);
  if (!client) return NextResponse.json({ error: "This review link isn't valid anymore." }, { status: 404 });
  const id = Number(rawId);
  const item = Number.isInteger(id) ? await getFeedback(client.slug, id) : null;
  if (!item) return NextResponse.json({ error: "Comment not found." }, { status: 404 });

  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const isTeam = await isTeamSession(req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value);
  const author = (typeof input.authorName === "string" && input.authorName.trim().slice(0, 80)) || (isTeam ? "MMG Studio" : "");
  const openUrl = `${req.nextUrl.origin}/review/${token}?c=${id}`;
  const thread = await slackThreadFor(id);
  const channel = client.integrations.feedbackAlerts?.slackChannel;
  const email = { clientSlug: client.slug, feedbackId: id, audience: isTeam ? "client" : "team", link: openUrl } as const;
  const emailClients = client.integrations.feedbackAlerts?.emailClients !== false;

  if (input.action === "reply") {
    const body = typeof input.body === "string" ? input.body.trim().slice(0, 5000) : "";
    if (!body || !author) return NextResponse.json({ error: "Add your name and a reply." }, { status: 400 });
    const authorEmail = typeof input.authorEmail === "string" ? input.authorEmail.trim().slice(0, 160) : null;
    if (typeof input.authorPhoto === "string") await savePhoto(client.slug, { name: author, email: authorEmail }, input.authorPhoto);
    await addReply(id, { body, authorName: author, authorEmail, isTeam });
    const photoRef = (await getFeedback(client.slug, id))?.replies.at(-1)?.authorPhoto;
    await notifyReply(thread, item, client.name, author, body, openUrl, { channel, photoUrl: photoRef ? `${req.nextUrl.origin}${photoPath(token, photoRef)}` : null });
    if (!isTeam || emailClients) await queueFeedbackEmail({ ...email, event: "reply", actor: author, body });
  } else if (input.action === "status" && isStatus(input.status)) {
    if (input.status === item.status) return NextResponse.json({ ok: true, comment: item });
    await setFeedbackStatus(id, input.status);
    await notifyStatus(thread, item, client.name, input.status, author || "Someone", channel);
    if (!isTeam || emailClients) await queueFeedbackEmail({ ...email, event: "status", actor: author || "Someone", body: input.status });
    if (input.status === "resolved") {
      await recordEvent(client.slug, { kind: "feedback_resolved", title: `Client feedback resolved: “${item.body.slice(0, 80)}”`, pages: [item.pagePath], source: "Client feedback", ref: `feedback:${item.id}` });
    }
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, comment: await getFeedback(client.slug, id) });
}
