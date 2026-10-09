import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, type ResponseSchema } from "@google/generative-ai";

// One structured call for the Agents tab. Uses Claude when ANTHROPIC_API_KEY is
// set (better writing, follows brand rules more closely), otherwise Gemini.
// Either way the reply is JSON matching `schema`.

export type JsonSchema =
  | { type: "string"; description?: string }
  | { type: "integer" | "number" | "boolean"; description?: string }
  | { type: "array"; items: JsonSchema; description?: string }
  | { type: "object"; properties: Record<string, JsonSchema>; description?: string };

export const CLAUDE_MODEL = "claude-opus-5-5";
const GEMINI_MODEL = "gemini-2.5-flash";

export function agentModelName() {
  return process.env.ANTHROPIC_API_KEY ? "Claude Opus 5.5" : process.env.GEMINI_API_KEY ? "Gemini 2.5 Flash" : null;
}

// Claude's structured outputs need every object closed and every field required.
function forClaude(schema: JsonSchema): Record<string, unknown> {
  if (schema.type === "object") {
    return {
      type: "object",
      ...(schema.description ? { description: schema.description } : {}),
      properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, forClaude(v)])),
      required: Object.keys(schema.properties),
      additionalProperties: false,
    };
  }
  if (schema.type === "array") return { ...schema, items: forClaude(schema.items) };
  return { ...schema };
}

// Gemini treats unlisted fields as optional and writes them in its own order;
// requiring everything and writing the summary last stops it from spending
// the whole reply on the summary.
function forGemini(schema: JsonSchema): Record<string, unknown> {
  if (schema.type === "object") {
    const keys = Object.keys(schema.properties);
    const ordered = [...keys.filter((k) => k !== "summary"), ...keys.filter((k) => k === "summary")];
    return {
      type: "object",
      ...(schema.description ? { description: schema.description } : {}),
      properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, forGemini(v)])),
      required: keys,
      propertyOrdering: ordered,
    };
  }
  if (schema.type === "array") return { ...schema, items: forGemini(schema.items) };
  return { ...schema };
}

// A usable reply has every top-level field and a short summary.
function complete(value: unknown, schema: JsonSchema): boolean {
  if (schema.type !== "object" || !value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Object.keys(schema.properties).every((k) => k in v)) return false;
  return typeof v.summary !== "string" || v.summary.length < 1500;
}

export class AgentError extends Error {}

async function runClaude<T>(system: string, prompt: string, schema: JsonSchema): Promise<T> {
  const client = new Anthropic();
  try {
    const stream = client.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 32000,
      // If a safety classifier declines, the API retries on Anthropic's
      // recommended fallback model instead of returning nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: forClaude(schema) } },
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new AgentError("The model declined this task. Try editing the task details and running it again.");
    if (message.stop_reason === "max_tokens") throw new AgentError("The draft ran too long and was cut off. Try again.");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = JSON.parse(text);
    if (!complete(parsed, schema)) throw new AgentError("The agent's reply was incomplete. Try again.");
    return parsed as T;
  } catch (err) {
    if (err instanceof AgentError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AgentError("ANTHROPIC_API_KEY was rejected. Check the key in Vercel.");
    if (err instanceof Anthropic.RateLimitError) throw new AgentError("Claude is rate limited right now. Try again in a minute.");
    if (err instanceof Anthropic.APIError) throw new AgentError(`Claude API error ${err.status}: ${err.message.slice(0, 200)}`);
    if (err instanceof SyntaxError) throw new AgentError("The agent's reply wasn't valid JSON. Try again.");
    throw err;
  }
}

async function runGemini<T>(system: string, prompt: string, schema: JsonSchema): Promise<T> {
  const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: system,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: forGemini(schema) as unknown as ResponseSchema,
      maxOutputTokens: 24000,
    },
  });
  // Gemini occasionally returns truncated JSON; one retry fixes it in practice.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await model.generateContent(prompt);
      const parsed = JSON.parse(res.response.text());
      if (complete(parsed, schema)) return parsed as T;
      lastErr = new Error("incomplete reply");
    } catch (err) {
      lastErr = err;
    }
  }
  throw new AgentError(`Gemini couldn't finish this draft (${String((lastErr as Error)?.message || lastErr).slice(0, 160)}).`);
}

export async function runStructured<T>(system: string, prompt: string, schema: JsonSchema): Promise<{ output: T; model: string }> {
  if (process.env.ANTHROPIC_API_KEY) return { output: await runClaude<T>(system, prompt, schema), model: "Claude Opus 5.5" };
  if (process.env.GEMINI_API_KEY) return { output: await runGemini<T>(system, prompt, schema), model: "Gemini 2.5 Flash" };
  throw new AgentError("No AI key is configured. Add ANTHROPIC_API_KEY (or GEMINI_API_KEY) in Vercel.");
}
