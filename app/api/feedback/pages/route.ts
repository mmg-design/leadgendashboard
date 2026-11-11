import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getReviewLink } from "@/lib/feedback";
import { reviewPages } from "@/lib/feedback-pages";

export const maxDuration = 60;

// Team-only: one review link per page of the client's site. They all use the
// client's single review link, so feedback from any of them lands together.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const client = slug ? await getClient(slug) : null;
  if (!slug || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const token = await getReviewLink(slug);
  return NextResponse.json({ pages: await reviewPages(client.domain, `${req.nextUrl.origin}/review/${token}`) });
}
