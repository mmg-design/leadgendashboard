import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { previewFeedbackEmail } from "@/lib/feedback-email";

// Team-only (behind the dashboard password): renders a feedback email with
// sample activity so the design can be checked without sending anything.
// ?client=<slug>&type=team|client
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  const client = slug ? await getClient(slug) : null;
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const kind = req.nextUrl.searchParams.get("type") === "client" ? "client" : "team";
  const email = await previewFeedbackEmail(client, kind, req.nextUrl.origin);
  // The tab shows the subject line, as an inbox would.
  return new NextResponse(email.html.replace(/<title>.*?<\/title>/, `<title>${email.subject.replace(/</g, "&lt;")}</title>`), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
