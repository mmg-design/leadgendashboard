import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const body = await req.json();
    const { clientName, range, ga, visitors, clarity } = body;

    // Build a rich context from all dashboard data
    const dataContext = buildDataContext(clientName, range, ga, visitors, clarity);

    const prompt = `You are a senior digital marketing strategist analyzing website visitor data for a client. Based on the following dashboard data (including Microsoft Clarity engagement scores when available), provide a concise, actionable analysis.

${dataContext}

Respond in this exact JSON format (no markdown fences, just raw JSON):
{
  "summary": "2-3 sentence overview of what the data tells us about this client's website performance and lead generation",
  "insights": [
    "Insight 1 about traffic patterns or notable trends",
    "Insight 2 about visitor behavior or source effectiveness",
    "Insight 3 about identified companies or lead quality"
  ],
  "actions": [
    "Specific action item 1 the team should take this week",
    "Specific action item 2 to improve lead generation",
    "Specific action item 3 to optimize the website",
    "Specific action item 4 for outreach or follow-up"
  ],
  "topPageAnalysis": "Brief analysis of which pages are performing best and what that means for the business",
  "leadScore": "low|medium|high — overall assessment of lead generation health"
}`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const rawText = response.text().trim();

    // Handle potential markdown code fences
    const jsonStr = rawText.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const analysis = JSON.parse(jsonStr);

    return NextResponse.json({ analysis });
  } catch (err: unknown) {
    console.error("AI analysis error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildDataContext(
  clientName: string,
  range: string,
  ga: {
    summary?: {
      sessions?: number;
      pageviews?: number;
      uniqueVisitors?: number;
      bounceRate?: string;
      avgSessionDuration?: string;
    };
    topSources?: { source: string; sessions: number }[];
    topPages?: { page: string; views: number }[];
  } | null,
  visitors: {
    visitors?: {
      company_name?: string;
      company_domain?: string;
      company_industry?: string;
      company_location?: string;
      sources?: string;
      total_visits?: number;
      pages_visited?: string;
    }[];
    stats?: {
      unique_companies?: number;
      total_visits?: number;
      active_sources?: number;
    };
  } | null,
  clarity: {
    pageEngagement?: {
      page: string;
      engagementScore: number;
      totalSessions: number;
    }[];
  } | null
): string {
  let ctx = `## Client: ${clientName}\n## Date Range: Last ${range}\n\n`;

  if (ga?.summary) {
    ctx += `### Google Analytics Summary\n`;
    ctx += `- Sessions: ${ga.summary.sessions?.toLocaleString() || "N/A"}\n`;
    ctx += `- Pageviews: ${ga.summary.pageviews?.toLocaleString() || "N/A"}\n`;
    ctx += `- Unique Visitors: ${ga.summary.uniqueVisitors?.toLocaleString() || "N/A"}\n`;
    ctx += `- Bounce Rate: ${ga.summary.bounceRate || "N/A"}\n`;
    ctx += `- Avg Session Duration: ${ga.summary.avgSessionDuration || "N/A"}\n\n`;
  }

  if (ga?.topSources?.length) {
    ctx += `### Traffic Sources (Top ${ga.topSources.length})\n`;
    ga.topSources.forEach((s) => {
      ctx += `- ${s.source}: ${s.sessions} sessions\n`;
    });
    ctx += "\n";
  }

  if (ga?.topPages?.length) {
    ctx += `### Top Pages\n`;
    ga.topPages.forEach((p) => {
      ctx += `- ${p.page}: ${p.views} views\n`;
    });
    ctx += "\n";
  }

  if (clarity?.pageEngagement?.length) {
    ctx += `### Microsoft Clarity — Page Engagement Scores\n`;
    clarity.pageEngagement.forEach((p) => {
      ctx += `- ${p.page}: engagement score ${p.engagementScore}/100 (${p.totalSessions} sessions)\n`;
    });
    ctx += "\n";
  }

  if (visitors?.stats) {
    ctx += `### Visitor Identification\n`;
    ctx += `- Companies Identified: ${visitors.stats.unique_companies || 0}\n`;
    ctx += `- Total Tracked Visits: ${visitors.stats.total_visits || 0}\n`;
    ctx += `- Active Sources: ${visitors.stats.active_sources || 0}\n\n`;
  }

  if (visitors?.visitors?.length) {
    ctx += `### Identified Companies\n`;
    visitors.visitors.forEach((v) => {
      ctx += `- ${v.company_name || "Unknown"} (${v.company_industry || "Unknown industry"}) — ${v.company_location || "Unknown location"} — ${v.total_visits} visits — Pages: ${v.pages_visited || "N/A"} — Sources: ${v.sources || "N/A"}\n`;
    });
    ctx += "\n";
  }

  return ctx;
}
