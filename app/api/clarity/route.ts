import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";

interface ClarityPageData {
  page: string;
  engagementScore: number;
  totalSessions: number;
}

interface ClarityResponse {
  topSessionUrl: string;
  pageEngagement: ClarityPageData[];
  projectId: string;
}

export async function GET(req: NextRequest) {
  const client = req.nextUrl.searchParams.get("client") || "example-client";
  const config = await getClient(client);

  if (!config?.integrations?.clarity?.enabled) {
    return NextResponse.json(
      { error: "Clarity not enabled for this client" },
      { status: 400 }
    );
  }

  const projectId = config.integrations.clarity.projectId;
  const token = process.env.CLARITY_API_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "CLARITY_API_TOKEN not configured" },
      { status: 500 }
    );
  }

  const topSessionUrl = `https://clarity.microsoft.com/projects/view/${projectId}/recordings`;

  let pageEngagement: ClarityPageData[] = [];
  try {
    const res = await fetch(
      `https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=7&dimension1=URL`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-clarity-project-id": projectId,
        },
      }
    );

    if (res.ok) {
      const data = await res.json();
      if (data?.information?.length) {
        pageEngagement = data.information
          .filter((item: any) => item.dimensionValue)
          .map((item: any) => {
            const sessions = Number(item.sessions) || 0;
            const pagesPerSession = Number(item.pagesPerSession) || 0;
            const scrollDepth = Number(item.scrollDepth) || 0;
            const activeTime = Number(item.activeTimeInSeconds) || 0;

            const scrollScore = Math.min(scrollDepth, 100);
            const timeScore = Math.min((activeTime / 120) * 100, 100);
            const pagesScore = Math.min((pagesPerSession / 3) * 100, 100);
            const engagementScore = Math.round(
              scrollScore * 0.4 + timeScore * 0.35 + pagesScore * 0.25
            );

            return {
              page: item.dimensionValue,
              engagementScore,
              totalSessions: sessions,
            };
          })
          .sort((a: ClarityPageData, b: ClarityPageData) => b.engagementScore - a.engagementScore)
          .slice(0, 10);
      }
    } else {
      console.log(`Clarity API responded ${res.status} — using recording link only`);
    }
  } catch (err) {
    console.error("Clarity API error:", err);
  }

  const response: ClarityResponse = {
    topSessionUrl,
    pageEngagement,
    projectId,
  };

  return NextResponse.json(response);
}
