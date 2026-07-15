import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getClient } from "@/lib/clients";

type FunnelRecommendation = {
  title: string;
  recommendation: string;
  evidence: string;
  impact: "high" | "medium" | "low";
};

export async function POST(req: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const body = await req.json();
    const { clientName, clientSlug, range, ga, visitors, clarity, seRanking, clickUp, mode, replaceIndex, existingRecommendations } = body;

    if (mode === "funnel-recommendations") {
      const config = typeof clientSlug === "string" ? await getClient(clientSlug) : null;
      const resolvedName = config?.name || clientName || clientSlug || "Client";
      const siteContext = config?.domain ? await fetchSiteContext(config.domain) : "Site content unavailable.";
      const dataContext = buildDataContext(resolvedName, range, ga, visitors, clarity, seRanking, clickUp);
      const replacementInstruction = Number.isInteger(replaceIndex)
        ? `Replace recommendation ${replaceIndex + 1}. Return one recommendation in the recommendations array. Do not repeat these existing ideas: ${JSON.stringify(existingRecommendations || [])}`
        : "Return 3 to 5 distinct recommendations, ordered by expected impact.";

      const prompt = `You are a senior conversion-rate optimization strategist. Analyze the measured funnel and the site's actual messaging. Make specific recommendations supported by the supplied evidence. Never invent a metric, page, feature, or user behavior. If evidence is limited, say what should be measured rather than pretending certainty.

${dataContext}
### Public site content
${siteContext}

${replacementInstruction}
Respond as raw JSON only:
{
  "recommendations": [{
    "title": "Short action-oriented title",
    "recommendation": "A concrete change: what to change, where, and why (maximum 45 words)",
    "evidence": "The exact dashboard metric or site-content observation supporting it (maximum 28 words)",
    "impact": "high|medium|low"
  }]
}`;

      const result = await model.generateContent(prompt);
      const parsed = parseModelJson(result.response.text()) as { recommendations?: FunnelRecommendation[] };
      const recommendations = Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter(isFunnelRecommendation).slice(0, Number.isInteger(replaceIndex) ? 1 : 5)
        : [];
      if (recommendations.length === 0) throw new Error("Gemini did not return usable recommendations");
      return NextResponse.json({ recommendations });
    }

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
    const analysis = parseModelJson(result.response.text());

    return NextResponse.json({ analysis });
  } catch (err: unknown) {
    console.error("AI analysis error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseModelJson(raw: string): unknown {
  const json = raw.trim().replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(json);
}

function isFunnelRecommendation(value: unknown): value is FunnelRecommendation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.title === "string" && typeof item.recommendation === "string" &&
    typeof item.evidence === "string" && ["high", "medium", "low"].includes(String(item.impact));
}

async function fetchSiteContext(domain: string): Promise<string> {
  try {
    const candidate = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return "Site content unavailable for a non-public hostname.";
    }
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "MMG-LeadGen-Analysis/1.0" },
    });
    if (!response.ok) return `Site returned HTTP ${response.status}; content unavailable.`;
    const html = (await response.text()).slice(0, 120_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
    return `Homepage URL: ${url.toString()}\nHomepage text: ${text.slice(0, 12_000)}`;
  } catch {
    return "Site content could not be fetched.";
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
    if (ga.summary.engagedSessions !== undefined) {
      const dropOff = Math.max((ga.summary.sessions || 0) - ga.summary.engagedSessions, 0);
      ctx += `- Engaged Sessions: ${ga.summary.engagedSessions.toLocaleString()}\n`;
      ctx += `- Visit-to-engagement Drop-off: ${dropOff.toLocaleString()} sessions\n`;
    }
    ctx += `- Avg Session Duration: ${ga.summary.avgSessionDuration || "N/A"}\n`;
    if (ga.comparison?.label) ctx += `- Comparison Baseline: ${ga.comparison.label}\n`;
    if (ga.summary.conversions?.length) {
      ctx += `- Conversion Events:\n`;
      ga.summary.conversions.forEach((conversion: { label?: string; page?: string; count?: number; change?: number | null }) => {
        const change = conversion.change == null ? "no prior-period baseline" : `${conversion.change > 0 ? "+" : ""}${conversion.change}% vs prior period`;
        ctx += `  · ${conversion.label || conversion.page || "Conversion"}: ${conversion.count || 0} (${change})\n`;
      });
    }
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
