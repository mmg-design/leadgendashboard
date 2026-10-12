import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getReviewLink, listFeedback, rotateReviewLink } from "@/lib/feedback";
import { slackConfigured } from "@/lib/slack";

// Team-only (behind the dashboard password): a client's review link and its
// feedback queue, for the Agents tab's Client Updates card.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug || !(await getClient(slug))) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const token = await getReviewLink(slug);
  return NextResponse.json({
    link: `${req.nextUrl.origin}/review/${token}`,
    token,
    slack: slackConfigured(),
    comments: await listFeedback(slug),
  });
}

// { client, rotate: true } replaces the link; the old one stops working.
export async function POST(req: NextRequest) {
  const { client: slug, rotate } = (await req.json()) as { client?: string; rotate?: boolean };
  if (!slug || !rotate || !(await getClient(slug))) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const token = await rotateReviewLink(slug);
  return NextResponse.json({ link: `${req.nextUrl.origin}/review/${token}`, token });
}
