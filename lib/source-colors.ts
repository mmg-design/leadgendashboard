// One color per traffic source, used by every chart that splits by source.
//
// Colors follow the source, never its rank: Google is blue whether it's #1 or
// #5 this week, so a client learns the colors once. The 8 hues are a
// colorblind-checked categorical set (validated against the white card
// surface). A few are light on white, so a colored mark is always paired with
// a text label and value; color never carries identity alone.

export const SOURCE_PALETTE = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
] as const;

export const OTHER_COLOR = "#b4c3c9";

// Lighter tint of a source color (mixed toward white) for gradient tops, so a
// gradient stays recognizably the same hue as the solid legend dot.
export function lighten(hex: string, amount = 0.38): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

interface KnownSource {
  match: (s: string) => boolean;
  key: string;
  label: string;
  slot: number; // index into SOURCE_PALETTE
}

const AI_HOSTS = ["chatgpt", "openai", "perplexity", "claude", "gemini", "copilot"];

const KNOWN: KnownSource[] = [
  { key: "google", label: "Google", slot: 0, match: (s) => s === "google" || s.includes("google.") },
  { key: "direct", label: "Direct", slot: 1, match: (s) => s === "(direct)" || s === "direct" || s === "(none)" },
  { key: "ai", label: "AI assistants", slot: 2, match: (s) => AI_HOSTS.some((h) => s.includes(h)) },
  { key: "linkedin", label: "LinkedIn", slot: 3, match: (s) => s.includes("linkedin") || s === "lnkd.in" },
  {
    key: "social",
    label: "Social media",
    slot: 4,
    match: (s) => /facebook|instagram|^fb$|^ig$|youtube|youtu\.be|tiktok|twitter|^x\.com$|^t\.co$|reddit|pinterest|threads/.test(s),
  },
  { key: "email", label: "Email", slot: 5, match: (s) => /mail|newsletter|hubspot|klaviyo|mailchimp/.test(s) },
  { key: "bing", label: "Bing / Yahoo / DuckDuckGo", slot: 6, match: (s) => /bing|yahoo|duckduckgo/.test(s) },
];

// Referrers we don't recognize get a stable slot from their name, so the same
// site keeps the same color across date ranges.
const UNKNOWN_SLOTS = [7, 6, 4, 5];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export interface SourceMeta {
  key: string;
  label: string;
  color: string;
}

export function sourceMeta(raw: string): SourceMeta {
  const s = raw.toLowerCase().trim();
  const known = KNOWN.find((k) => k.match(s));
  if (known) return { key: known.key, label: known.label, color: SOURCE_PALETTE[known.slot] };
  if (s === "(not set)" || s === "(data not available)" || !s) return { key: "unknown", label: "Unknown", color: OTHER_COLOR };
  const label = raw
    .replace(/^www\./, "")
    .replace(/\.(com|org|net|io|co)$/, "")
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { key: s, label, color: SOURCE_PALETTE[UNKNOWN_SLOTS[hash(s) % UNKNOWN_SLOTS.length]] };
}

export interface SourceTotal extends SourceMeta {
  sessions: number;
}

// Folds raw GA sources into display groups (chatgpt.com + perplexity.ai become
// "AI assistants"), largest first. Two groups never share a color: if an
// unrecognized referrer's color is already on screen, it takes the next free hue.
export function groupSources(rows: { source: string; sessions: number }[]): SourceTotal[] {
  const groups = new Map<string, SourceTotal>();
  for (const row of rows) {
    const meta = sourceMeta(row.source);
    const existing = groups.get(meta.key);
    if (existing) existing.sessions += row.sessions;
    else groups.set(meta.key, { ...meta, sessions: row.sessions });
  }
  const sorted = [...groups.values()].sort((a, b) => b.sessions - a.sessions);

  const knownKeys = new Set(KNOWN.map((k) => k.key));
  const used = new Set(sorted.filter((g) => knownKeys.has(g.key)).map((g) => g.color));
  for (const g of sorted) {
    if (knownKeys.has(g.key) || g.color === OTHER_COLOR) continue;
    if (used.has(g.color)) {
      g.color = SOURCE_PALETTE.find((c) => !used.has(c)) || OTHER_COLOR;
    }
    used.add(g.color);
  }
  return sorted;
}
