import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getClient } from "@/lib/clients";

const SNITCHER_API_BASE = "https://api.snitcher.com/v1";

export async function POST(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client");
  if (!client) {
    return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  }

  const config = await getClient(client);
  if (!config?.integrations?.snitcher?.enabled) {
    return NextResponse.json({ error: "Snitcher not enabled for this client" }, { status: 400 });
  }

  const apiToken = process.env.SNITCHER_API_TOKEN;
  const workspaceId = config.integrations.snitcher.workspaceId;

  if (!apiToken) {
    return NextResponse.json({ error: "SNITCHER_API_TOKEN not configured" }, { status: 500 });
  }
  if (!workspaceId) {
    return NextResponse.json({ error: "Snitcher workspaceId not configured for this client" }, { status: 400 });
  }

  try {
    // Determine date range from request body or default to last 30 days
    let days = 30;
    try {
      const body = await req.json();
      if (body.days) days = Math.min(body.days, 90);
    } catch {
      // No body — use default
    }

    const dateTo = new Date().toISOString().split("T")[0];
    const dateFrom = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

    // Fetch organisations from Snitcher API (paginated)
    let allOrgs: any[] = [];
    let page = 1;
    let lastPage = 1;

    while (page <= lastPage) {
      const url = `${SNITCHER_API_BASE}/workspaces/${workspaceId}/organisations?date_from=${dateFrom}&date_to=${dateTo}&size=100&page=${page}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Snitcher API error (${res.status}):`, errText);
        return NextResponse.json(
          { error: `Snitcher API error: ${res.status}`, details: errText },
          { status: res.status }
        );
      }

      const data = await res.json();
      lastPage = data.last_page || 1;
      const orgs = data.data || [];
      allOrgs = allOrgs.concat(orgs);
      page++;

      // Safety: max 5 pages (500 orgs) per sync
      if (page > 5) break;
    }

    // Also fetch sessions for richer visit data
    const sessionsUrl = `${SNITCHER_API_BASE}/workspaces/${workspaceId}/sessions?date_from=${dateFrom}&date_to=${dateTo}&size=100`;
    const sessionsRes = await fetch(sessionsUrl, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });

    let sessionsMap: Record<string, any[]> = {};
    if (sessionsRes.ok) {
      const sessionsData = await sessionsRes.json();
      const sessions = sessionsData.data || [];
      for (const s of sessions) {
        const orgId = s.organisation_uuid;
        if (!sessionsMap[orgId]) sessionsMap[orgId] = [];
        sessionsMap[orgId].push(s);
      }
    }

    // Normalize and upsert into visitors table
    const db = await getDb();
    let inserted = 0;

    for (const org of allOrgs) {
      const orgSessions = sessionsMap[org.uuid] || [];
      const lastSession = orgSessions[0]; // Most recent

      // Build location string
      const location = org.address
        ? [org.address.city, org.address.state, org.address.country].filter(Boolean).join(", ")
        : null;

      // Collect pages visited from sessions
      const pages = orgSessions
        .flatMap((s: any) => (s.views || []).map((v: any) => v.url))
        .filter(Boolean);
      const uniquePages = [...new Set(pages)].slice(0, 10).join(", ");

      // Get referrer from last session
      const referrer = lastSession?.referrer || null;

      const sourceId = org.uuid;
      const visitDate = org.last_seen || new Date().toISOString();
      const visitCount = orgSessions.length || 1;

      await db.execute({
        sql: `INSERT OR REPLACE INTO visitors
          (client_slug, source, source_id, company_name, company_domain, company_industry, company_size, company_location,
           person_name, person_email, person_title, person_linkedin, page_url, referrer, visit_date, visit_count, raw_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          client,
          "snitcher",
          sourceId,
          org.name || null,
          org.website?.replace(/^https?:\/\//, "").replace(/\/$/, "") || null,
          org.industry || null,
          org.size || null,
          location,
          null, // person_name (org-level only)
          org.email || null,
          null, // person_title
          Array.isArray(org.profiles) ? org.profiles.find((p: any) => p.name === "LinkedIn")?.url || null : null,
          uniquePages || null,
          referrer,
          visitDate,
          visitCount,
          JSON.stringify(org),
        ],
      });
      inserted++;
    }

    console.log(`[Snitcher Sync] Pulled ${allOrgs.length} organisations, ${inserted} upserted for ${client}`);

    return NextResponse.json({
      ok: true,
      synced: inserted,
      total_available: allOrgs.length,
      date_range: { from: dateFrom, to: dateTo },
    });
  } catch (err: unknown) {
    console.error("Snitcher sync error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
