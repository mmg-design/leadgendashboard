import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { getClient } from "@/lib/clients";
import { brandTerms, classifyKeyword } from "@/lib/keyword-insights";

// Suggested AI prompts for a client that isn't tracked yet: their highest-volume
// non-brand SE Ranking keywords, rewritten as the questions a buyer would ask
// ChatGPT. Nothing is created here; the user edits and confirms first.

export async function POST(req: NextRequest) {
  const { client: slug } = (await req.json()) as { client?: string };
  if (!slug) return NextResponse.json({ error: "Missing client" }, { status: 400 });
  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });

  // Top tracked keywords by search volume, brand searches removed: nobody asks
  // ChatGPT "who is Exact Medicare" to find a provider.
  let keywords: string[] = [];
  const siteId = config.integrations.seRanking?.enabled ? config.integrations.seRanking.projectId : "";
  if (siteId && process.env.SERANKING_API_KEY) {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `https://api.seranking.com/v1/project-management/sites/positions?site_id=${siteId}&date_from=${today}&date_to=${today}`,
      { headers: { Authorization: `Token ${process.env.SERANKING_API_KEY}` }, cache: "no-store" }
    ).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { keywords?: { name: string; volume?: number | null }[] }[]) : [];
    const brands = brandTerms(config.name, config.domain);
    keywords = (data[0]?.keywords || [])
      .filter((k) => !classifyKeyword(k.name, brands).branded)
      .sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0))
      .slice(0, 20)
      .map((k) => k.name);
  }

  const prompt = `You help set up AI-search tracking for ${config.name} (${config.domain}).
Write 8 prompts that a potential customer would realistically type into ChatGPT or Perplexity when looking for what this business offers.

The business's tracked search keywords, highest search volume first:
${keywords.length ? keywords.map((k) => `- ${k}`).join("\n") : "- (none tracked; infer from the business name and domain)"}

Rules:
- Natural, conversational questions or requests (8-20 words), the way people talk to an AI assistant.
- Never include the business's own name; we want to know if AI recommends it unprompted.
- Keep any location from the keywords. Mix "recommend a provider" prompts with "help me understand" prompts.
- Each under 200 characters. No em dashes.`;

  try {
    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: { prompts: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } } },
          required: ["prompts"],
        },
      },
    });
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text()) as { prompts?: string[] };
    const prompts = (parsed.prompts || []).map((p) => p.trim()).filter((p) => p && p.length <= 255).slice(0, 10);
    return NextResponse.json({ prompts, basedOn: keywords.slice(0, 8) });
  } catch (err) {
    console.error("Prompt suggestion error:", err);
    return NextResponse.json({ error: "Couldn't suggest prompts right now." }, { status: 500 });
  }
}
