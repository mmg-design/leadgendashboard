import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");
  const days = parseInt(req.nextUrl.searchParams.get("days") || "7");

  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const db = await getDb();

  const visitorsResult = await db.execute({
    sql: `
      SELECT
        company_name,
        company_domain,
        company_industry,
        company_size,
        company_location,
        person_name,
        person_email,
        person_title,
        person_linkedin,
        GROUP_CONCAT(DISTINCT source) as sources,
        GROUP_CONCAT(DISTINCT source || ':' || source_id) as source_ids,
        MAX(visit_date) as last_visit,
        SUM(visit_count) as total_visits,
        GROUP_CONCAT(DISTINCT page_url) as pages_visited
      FROM visitors
      WHERE client_slug = ?
        AND visit_date > datetime('now', ?)
      GROUP BY COALESCE(company_domain, source_id)
      ORDER BY last_visit DESC
      LIMIT 100
    `,
    args: [client, `-${days} days`],
  });

  const statsResult = await db.execute({
    sql: `
      SELECT
        COUNT(DISTINCT COALESCE(company_domain, source_id)) as unique_companies,
        COUNT(DISTINCT person_email) as identified_people,
        SUM(visit_count) as total_visits,
        COUNT(DISTINCT source) as active_sources
      FROM visitors
      WHERE client_slug = ?
        AND visit_date > datetime('now', ?)
    `,
    args: [client, `-${days} days`],
  });

  return NextResponse.json({
    visitors: visitorsResult.rows,
    stats: statsResult.rows[0] || {},
    days,
  });
}
