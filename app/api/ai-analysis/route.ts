import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const body = await req.json();
    const { clientName, range, ga, visitors, clarity, seRanking, clickUp } = body;

    const dataContext = buildDataContext(clientName, range, ga, visitors, clarity, seRanking, clickUp);

    const prompt = `You are a senior digital marketing strategist reviewing a client dashboard. Give a brief, actionable analysis. The client is a healthcare B2B company. Keep it punchy - a busy account manager should read it in 20 seconds.

${dataContext}

Respond in this exact JSON format (no markdown fences, just raw JSON):
{
  "summary": "2-3 sentences. Plain English. What's the most important thing happening right now - good or bad.",
  "actions": [
    "One quick-win action based on the data (max 15 words)",
    "One growth or SEO opportunity (max 15 words)",
    "One thing to investigate or watch (max 15 words)"
  ],
  "leadScore": "low|medium|high"
}`;

    const result = await model.generateContent(prompt);
    const rawText = result.response.text().trim();
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
  ga: any,
  visitors: any,
  clarity: any,
  seRanking: any,
  clickUp: any
): string {
  let ctx = `## Client: ${clientName}\n## Date Range: Last ${range}\n\n`;

  if (ga?.summary) {
    ctx += `### Google Analytics\n`;
    ctx += `- Sessions: ${ga.summary.sessions?.toLocaleString() || "N/A"}`;
    if (ga.summary.sessionsChange !== null && ga.summary.sessionsChange !== undefined) {
      ctx += ` (${ga.summary.sessionsChange > 0 ? "+" : ""}${ga.summary.sessionsChange}% vs prior period)`;
    }
    ctx += `\n- Unique Visitors: ${ga.summary.uniqueVisitors?.toLocaleString() || "N/A"}\n`;
    ctx += `- Engagement Rate: ${ga.summary.engagementRate || ga.summary.bounceRate || "N/A"}\n`;
    ctx += `- Avg Session Duration: ${ga.summary.avgSessionDuration || "N/A"}\n`;
    if (ga.topSources?.length) {
      ctx += `- Top Sources: ${ga.topSources.slice(0, 4).map((s: any) => `${s.source} (${s.sessions})`).join(", ")}\n`;
    }
    if (ga.topPages?.length) {
      ctx += `- Top Pages: ${ga.topPages.slice(0, 3).map((p: any) => `${p.page} (${p.views} views)`).join(", ")}\n`;
    }
    ctx += "\n";
  }

  if (clarity) {
    ctx += `### Microsoft Clarity - User Behavior\n`;
    if (clarity.homepageScrollDepth !== null && clarity.homepageScrollDepth !== undefined) {
      ctx += `- Homepage Scroll Depth: ${clarity.homepageScrollDepth}% (avg how far users scroll on homepage)\n`;
    }
    if (clarity.rageClicks !== undefined) ctx += `- Rage Clicks: ${clarity.rageClicks} (frustrated rapid clicks - signals broken UX)\n`;
    if (clarity.deadClicks !== undefined) ctx += `- Dead Clicks: ${clarity.deadClicks} (clicks on non-interactive elements - signals confusing UI)\n`;
    if (clarity.pageEngagement?.length) {
      ctx += `- Page Engagement Scores:\n`;
      clarity.pageEngagement.slice(0, 5).forEach((p: any) => {
        ctx += `  · ${p.page.replace(/^https?:\/\/[^/]+/, "") || "/"}: ${p.engagementScore}/100\n`;
      });
    }
    ctx += "\n";
  }

  if (seRanking) {
    ctx += `### SE Ranking - Search Visibility\n`;
    ctx += `- Domain Visibility: ${seRanking.currentVisibility !== null ? `${seRanking.currentVisibility?.toFixed(1)}%` : "0% (new project)"}\n`;
    ctx += `- Keywords Tracked: ${seRanking.totalKeywords}\n`;
    ctx += `- Moved Up This Week: ${seRanking.movedUp} keywords\n`;
    ctx += `- Moved Down This Week: ${seRanking.movedDown} keywords\n`;
    if (seRanking.top5?.length) {
      ctx += `- Top Ranked Keywords:\n`;
      seRanking.top5.forEach((kw: any) => {
        ctx += `  · "${kw.keyword}": #${kw.position}${kw.delta !== null ? ` (${kw.delta > 0 ? "+" : ""}${kw.delta} this week)` : ""}\n`;
      });
    } else {
      ctx += `- No keywords ranking in top 100 yet (project is new)\n`;
    }
    ctx += "\n";
  }

  if (clickUp) {
    ctx += `### ClickUp - Project Work\n`;
    ctx += `- Active Tasks: ${clickUp.activeTaskCount}\n`;
    ctx += `- Completed This Month: ${clickUp.completedThisMonthCount}\n`;
    if (clickUp.overdueCount > 0) ctx += `- Overdue Tasks: ${clickUp.overdueCount} ⚠️\n`;
    if (clickUp.phaseGroups?.length) {
      ctx += `- Work by Phase: ${clickUp.phaseGroups.map((p: any) => `${p.phase} (${p.count})`).join(", ")}\n`;
    }
    if (clickUp.activityFeed?.length) {
      ctx += `- Recently Completed: ${clickUp.activityFeed.slice(0, 3).map((t: any) => `"${t.name}"`).join(", ")}\n`;
    }
    ctx += "\n";
  }

  if (visitors?.stats) {
    ctx += `### Visitor Identification\n`;
    ctx += `- Companies Identified: ${visitors.stats.unique_companies || 0}\n`;
    ctx += `- Total Tracked Visits: ${visitors.stats.total_visits || 0}\n\n`;
  }

  return ctx;
}
