// Reads a client's live pages the way a crawler would: title, meta description,
// headings, structured data, and the visible text. Used by the Agents scan
// (on-page checks) and to give each agent the page it's rewriting.

export interface PageSnapshot {
  url: string;
  ok: boolean;
  status: number;
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  jsonLdTypes: string[];
  robotsNoindex: boolean;
  canonical: string | null;
  internalLinks: number;
  text: string; // visible text, trimmed to TEXT_LIMIT
}

const TEXT_LIMIT = 8000;
const UA = "Mozilla/5.0 (compatible; MMGDashboardBot/1.0; +https://data.mmg.studio)";

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: string) {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, attr: "name" | "property", value: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
    if (key?.toLowerCase() === value) return decode(tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || "").trim();
  }
  return "";
}

function allMatches(html: string, re: RegExp) {
  return [...html.matchAll(re)].map((m) => stripTags(m[1])).filter(Boolean);
}

function jsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node && typeof node === "object") {
          const t = (node as Record<string, unknown>)["@type"];
          if (typeof t === "string") types.add(t);
          if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
          const graph = (node as Record<string, unknown>)["@graph"];
          if (graph) walk(graph);
        }
      };
      walk(JSON.parse(m[1]));
    } catch { /* malformed JSON-LD counts as none */ }
  }
  return [...types];
}

export async function fetchPage(url: string): Promise<PageSnapshot> {
  const empty: PageSnapshot = {
    url, ok: false, status: 0, title: "", metaDescription: "", h1: [], h2: [], jsonLdTypes: [],
    robotsNoindex: false, canonical: null, internalLinks: 0, text: "",
  };
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12000) });
  } catch {
    return empty;
  }
  if (!res.ok) return { ...empty, status: res.status };
  const html = (await res.text()).slice(0, 1_500_000);
  const host = (() => { try { return new URL(res.url || url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " ");
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const internalLinks = links.filter((h) => h.startsWith("/") || h.includes(host)).length;
  return {
    url: res.url || url,
    ok: true,
    status: res.status,
    title: stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""),
    metaDescription: metaContent(html, "name", "description"),
    h1: allMatches(body, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi),
    h2: allMatches(body, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 20),
    jsonLdTypes: jsonLdTypes(html),
    robotsNoindex: /noindex/i.test(metaContent(html, "name", "robots")),
    canonical: html.match(/<link[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1] || null,
    internalLinks,
    text: stripTags(body.match(/<body[\s\S]*<\/body>/i)?.[0] || body).slice(0, TEXT_LIMIT),
  };
}

// URLs listed in the site's sitemap (follows one level of sitemap index).
export async function sitemapUrls(origin: string, limit = 300): Promise<string[]> {
  const get = async (u: string) => {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(10000) });
      return r.ok ? await r.text() : "";
    } catch {
      return "";
    }
  };
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  const root = await get(`${origin.replace(/\/$/, "")}/sitemap.xml`);
  if (!root) return [];
  if (/<sitemapindex/i.test(root)) {
    const children = locs(root).slice(0, 10);
    const all: string[] = [];
    for (const xml of await Promise.all(children.map(get))) all.push(...locs(xml));
    return [...new Set(all)].slice(0, limit);
  }
  return [...new Set(locs(root))].slice(0, limit);
}
