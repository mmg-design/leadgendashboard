import Anthropic from "@anthropic-ai/sdk";

// Every AI call in MMG Pulse goes through Claude. runStructured returns JSON
// matching `schema`; runText returns plain text for free-form replies.

export type JsonSchema =
  | { type: "string"; description?: string }
  | { type: "integer" | "number" | "boolean"; description?: string }
  | { type: "array"; items: JsonSchema; description?: string }
  | { type: "object"; properties: Record<string, JsonSchema>; description?: string };

export const CLAUDE_MODEL = "claude-opus-5-5";
const MODEL_NAME = "Claude Opus 5.5";

type Effort = "low" | "medium" | "high";

export function agentModelName() {
  return process.env.ANTHROPIC_API_KEY ? MODEL_NAME : null;
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

// A usable reply has every top-level field and a short summary.
function complete(value: unknown, schema: JsonSchema): boolean {
  if (schema.type !== "object" || !value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Object.keys(schema.properties).every((k) => k in v)) return false;
  return typeof v.summary !== "string" || v.summary.length < 1500;
}

export class AgentError extends Error {}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AgentError("Claude isn't connected. Add ANTHROPIC_API_KEY in Vercel, then redeploy.");
  return new Anthropic();
}

async function ask(system: string, prompt: string, effort: Effort, format?: Record<string, unknown>): Promise<string> {
  try {
    const stream = client().beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 32000,
      // If a safety classifier declines, the API retries on Anthropic's
      // recommended fallback model instead of returning nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort, ...(format ? { format: { type: "json_schema", schema: format } } : {}) },
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new AgentError("The model declined this task. Try editing the task details and running it again.");
    if (message.stop_reason === "max_tokens") throw new AgentError("The draft ran too long and was cut off. Try again.");
    return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  } catch (err) {
    if (err instanceof AgentError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AgentError("ANTHROPIC_API_KEY was rejected. Check the key in Vercel.");
    if (err instanceof Anthropic.RateLimitError) throw new AgentError("Claude is rate limited right now. Try again in a minute.");
    if (err instanceof Anthropic.APIError) throw new AgentError(`Claude API error ${err.status}: ${err.message.slice(0, 200)}`);
    throw err;
  }
}

export async function runStructured<T>(
  system: string,
  prompt: string,
  schema: JsonSchema,
  opts: { effort?: Effort } = {}
): Promise<{ output: T; model: string }> {
  const text = await ask(system, prompt, opts.effort || "medium", forClaude(schema));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AgentError("The agent's reply wasn't valid JSON. Try again.");
  }
  if (!complete(parsed, schema)) throw new AgentError("The agent's reply was incomplete. Try again.");
  return { output: parsed as T, model: MODEL_NAME };
}

export async function runText(system: string, prompt: string, opts: { effort?: Effort } = {}): Promise<string> {
  return ask(system, prompt, opts.effort || "medium");
}
