export type HealthStatus = "good" | "warning" | null;

interface Threshold {
  good: (v: number) => boolean;
  warning: (v: number) => boolean;
}

// SMB website benchmarks - thresholds scaled by date range where applicable
const thresholds: Record<string, Threshold> = {
  bounceRate: {
    good: (v) => v < 50,
    warning: (v) => v > 65,
  },
  sessionDuration: {
    good: (v) => v > 90, // seconds
    warning: (v) => v < 45,
  },
  pagesPerSession: {
    good: (v) => v > 2.0,
    warning: (v) => v < 1.3,
  },
  companiesIdentified: {
    good: (v) => v > 3,
    warning: (v) => v < 1,
  },
  sessions: {
    good: (v) => v > 50,
    warning: (v) => v < 15,
  },
};

// Scale thresholds for longer date ranges (base = 7d)
function scaleForRange(metric: string, value: number, range?: string): number {
  if (!range) return value;
  const multiplier = range === "30d" ? 30 / 7 : range === "90d" ? 90 / 7 : 1;
  // Only scale count-based metrics, not ratios
  if (metric === "sessions" || metric === "companiesIdentified") {
    return value / multiplier; // Normalize to weekly equivalent
  }
  return value;
}

export function getHealth(metric: string, value: number, range?: string): HealthStatus {
  const t = thresholds[metric];
  if (!t || isNaN(value)) return null;

  const normalized = scaleForRange(metric, value, range);

  if (t.good(normalized)) return "good";
  if (t.warning(normalized)) return "warning";
  return null; // In between - neutral
}

// Parse "1m 23s" or "45s" or "2m 0s" to seconds
export function parseSessionDuration(str: string): number {
  if (!str || str === "-") return NaN;
  const minMatch = str.match(/(\d+)m/);
  const secMatch = str.match(/(\d+)s/);
  const minutes = minMatch ? parseInt(minMatch[1]) : 0;
  const seconds = secMatch ? parseInt(secMatch[1]) : 0;
  return minutes * 60 + seconds;
}
