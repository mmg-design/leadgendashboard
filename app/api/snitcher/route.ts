import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeSnitcher } from "@/lib/normalize";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");

  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM visitors WHERE client_slug = ? AND source = 'snitcher' ORDER BY visit_date DESC LIMIT 100`,
    args: [client],
  });

  return NextResponse.json({ visitors: result.rows, count: result.rows.length });
}

export async function POST(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");

  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const secret = process.env.SNITCHER_WEBHOOK_SECRET;
  let body: unknown;

  if (secret) {
    const signature = req.headers.get("x-snitcher-signature") || req.headers.get("x-webhook-signature") || "";
    const rawBody = await req.text();

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature && signature !== expected) {
      console.warn(`[Snitcher Webhook] Invalid signature for ${client}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  } else {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  return processPayload(body, client);
}

async function processPayload(body: unknown, client: string) {
  const db = await getDb();
  const events = Array.isArray(body) ? body : [body];

  const normalized = events.map((v: unknown) => normalizeSnitcher(v));

  await db.batch(
    normalized.map((n, i) => ({
      sql: `INSERT OR REPLACE INTO visitors
        (client_slug, source, source_id, company_name, company_domain, company_industry, company_size, company_location,
         person_name, person_email, person_title, person_linkedin, page_url, referrer, visit_date, visit_count, raw_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        client, n.source, n.sourceId,
        n.companyName, n.companyDomain, n.companyIndustry, n.companySize, n.companyLocation,
        n.personName, n.personEmail, n.personTitle, n.personLinkedin,
        n.pageUrl, n.referrer, n.visitDate, n.visitCount,
        JSON.stringify(events[i]),
      ],
    }))
  );

  console.log(`[Snitcher Webhook] Received ${normalized.length} visitor(s) for ${client}`);

  return NextResponse.json({ received: normalized.length, ok: true });
}
