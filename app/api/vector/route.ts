import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeVector } from "@/lib/normalize";

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");

  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM visitors WHERE client_slug = ? AND source = 'vector' ORDER BY visit_date DESC LIMIT 100`,
    args: [client],
  });

  return NextResponse.json({ visitors: result.rows, count: result.rows.length });
}

export async function POST(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");

  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const db = await getDb();
  const events = Array.isArray(body) ? body : [body];

  const normalized = events.map((v: unknown) => normalizeVector(v));

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

  console.log(`[Vector Webhook] Received ${normalized.length} visitor(s) for ${client}`);

  return NextResponse.json({ received: normalized.length, ok: true });
}
