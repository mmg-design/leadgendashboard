import type { ClientConfig } from "./clients";
import type { StoredTask } from "./agent-tasks";
import { runStructured, type JsonSchema } from "./agent-llm";
import { fetchPage, sitemapUrls, type PageSnapshot } from "./page-fetch";
import { getAnswer } from "./airt";
import type { IndexStatus } from "./gsc";
import { normalizePath } from "./page-behavior";

// What each agent produces. Every field is optional except summary and steps,
// so the Agents tab can render any task's draft with one component.
export interface AgentOutput {
  summary: string;
  seo?: { title: string; metaDescription: string; h1: string };
  sections?: { heading: string; body: string }[];
  faq?: { question: string; answer: string }[];
  newPage?: { slug: string; bodyHtml: string };
  targetPage?: string;
  schemaJsonLd?: string;
  internalLinks?: { fromPage: string; anchorText: string }[];
  outreach?: { target: string; approach: string; pitchSubject: string; pitchBody: string }[];
  findings?: { issue: string; likelyCause: string; fix: string }[];
  steps: { title: string; detail: string }[];
  model: string;
  generatedAt: string;
}

// ── Schema pieces ───────────────────────────────────────────────────────────

const str = (description?: string): JsonSchema => ({ type: "string", ...(description ? { description } : {}) });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: "object", properties });
const arr = (items: JsonSchema, description?: string): JsonSchema => ({ type: "array", items, ...(description ? { description } : {}) });

const SUMMARY = str("Under 40 words: what you drafted and why it should work. Do not describe how you followed the instructions.");
const SEO = obj({
  title: str("SEO title tag, 50-60 characters, primary keyword near the start"),
  metaDescription: str("140-155 characters, specific benefit plus a reason to click"),
  h1: str("The page's single H1"),
});
const STEPS = arr(obj({ title: str(), detail: str() }), "Checklist for whoever implements this, in order. Include anything you couldn't do yourself.");
const FAQ = arr(obj({ question: str(), answer: str("40-80 words, answer first") }));
const SECTIONS = arr(obj({ heading: str("H2 heading"), body: str("Ready-to-paste copy. Plain text with short paragraphs; use '- ' for list items.") }));
const JSONLD = str("A complete JSON-LD script body (JSON only, no <script> tag). Empty string if not useful.");
const NEW_PAGE = obj({
  slug: str("URL slug, lowercase-hyphenated, no leading slash"),
  bodyHtml: str("Full page body as clean semantic HTML: h2, h3, p, ul, ol, li, strong, em, a. No h1 (it's separate), no classes, no inline styles, no scripts."),
});

const SCHEMAS: Record<string, JsonSchema> = {
  ctr: obj({ summary: SUMMARY, seo: SEO, steps: STEPS }),
  onpage: obj({ summary: SUMMARY, seo: SEO, schemaJsonLd: JSONLD, steps: STEPS }),
  striking: obj({
    summary: SUMMARY,
    seo: SEO,
    sections: SECTIONS,
    faq: FAQ,
    internalLinks: arr(obj({ fromPage: str("Path of an existing page that should link here"), anchorText: str() })),
    steps: STEPS,
  }),
  missing_page: obj({ summary: SUMMARY, seo: SEO, newPage: NEW_PAGE, faq: FAQ, schemaJsonLd: JSONLD, steps: STEPS }),
  ai_prompt: obj({
    summary: SUMMARY,
    targetPage: str("Existing path to add this content to, or 'new' if it needs its own page"),
    seo: SEO,
    newPage: NEW_PAGE,
    faq: FAQ,
    schemaJsonLd: JSONLD,
    steps: STEPS,
  }),
  ai_source: obj({
    summary: SUMMARY,
    outreach: arr(obj({
      target: str("Who or what to contact on this site (editor, listing form, review profile, forum thread)"),
      approach: str("How to get included, specifically for this site"),
      pitchSubject: str("Email subject or post title; empty if not an email"),
      pitchBody: str("Ready-to-send message, under 150 words, with [placeholders] for anything you don't know"),
    })),
    steps: STEPS,
  }),
  ux_leak: obj({
    summary: SUMMARY,
    findings: arr(obj({ issue: str(), likelyCause: str("What on this page most likely causes it, based on the page content"), fix: str() })),
    steps: STEPS,
  }),
};

// ── Prompts ─────────────────────────────────────────────────────────────────

function system(config: ClientConfig, about: string) {
  return `You are a senior SEO and AI-search (GEO) specialist at MMG, a marketing agency, doing hands-on work for the client ${config.name} (${config.domain}).

About the client, from their homepage:
${about || "(homepage unavailable; infer carefully from the domain and task)"}

How you work:
- Write for the client's customers, in the client's voice. Clear, specific, confident. No hype words ("unlock", "elevate", "seamless", "cutting-edge"). No em dashes.
- Never invent facts: prices, years in business, license numbers, statistics, reviews, awards, staff names, addresses, phone numbers. Where a fact is needed, write a [placeholder in brackets] and add a step telling the team to fill it in.
- Search: put the primary keyword early in the title and H1, match the searcher's intent, and give a reason to click over the other results.
- AI search: AI engines quote pages that answer the question directly in the first sentence, name the business and what it does plainly, cover the specifics a buyer compares (who it's for, process, cost range, location, credentials), and back claims with facts. Structure content so a sentence can be lifted as an answer.
- Everything you return should be ready to paste or ship. Be concrete; skip generic advice.`;
}

function pageBlock(label: string, p: PageSnapshot | null) {
  if (!p?.ok) return `${label}: (couldn't load the live page)`;
  return `${label} (${p.url})
Title: ${p.title || "(none)"}
Meta description: ${p.metaDescription || "(none)"}
H1: ${p.h1.join(" | ") || "(none)"}
H2s: ${p.h2.join(" | ") || "(none)"}
Structured data types: ${p.jsonLdTypes.join(", ") || "(none)"}
Visible text:
${p.text.slice(0, 6000)}`;
}

const list = (items: string[]) => items.map((e) => `- ${e}`).join("\n");

function taskBlock(task: StoredTask) {
  return `Task: ${task.title}
Why it matters: ${task.why}
Evidence:
${list(task.evidence)}`;
}

// ── Indexing (no model needed) ──────────────────────────────────────────────

function indexingOutput(task: StoredTask, page: PageSnapshot | null): AgentOutput {
  const status = (task.data?.status || {}) as Partial<IndexStatus>;
  const steps: AgentOutput["steps"] = [];
  if (page?.ok && page.robotsNoindex) {
    steps.push({ title: "Remove the noindex tag", detail: "The live page has <meta name=\"robots\" content=\"noindex\">. In Webflow: Page settings, turn off \"Exclude this page from search results\" (or remove the custom robots meta), then publish." });
  }
  const canonicalPath = page?.canonical ? (() => { try { return normalizePath(new URL(page.canonical!, task.url).pathname); } catch { return null; } })() : null;
  if (page?.ok && canonicalPath && task.path && canonicalPath !== task.path) {
    steps.push({ title: "Fix the canonical URL", detail: `The page's canonical points to ${page.canonical}. If this page should rank on its own, set the canonical to its own URL.` });
  }
  if (!status.inSitemap) steps.push({ title: "Make sure Google reads it from the sitemap", detail: "Google hasn't seen this URL in a sitemap. In Webflow, check that sitemap indexing is on for this page (and its CMS collection, if it's a CMS page), then use Resubmit sitemap below." });
  if (!status.hasInternalLinks) steps.push({ title: "Link to it from a page Google already indexes", detail: "Add a link from the homepage, main navigation, footer, or a related page. Pages with no internal links are often skipped." });
  if (page?.ok && page.text.length < 1200) steps.push({ title: "Add more useful content", detail: `The page has only about ${Math.round(page.text.split(/\s+/).length)} words of text. Thin pages are often crawled but not indexed. Aim for a complete answer to what the page is about.` });
  // Google's own fix list overlaps with the steps above; keep only what's new.
  for (const fix of status.fixes || []) {
    if (!/sitemap|link|request indexing/i.test(fix)) steps.push({ title: fix, detail: "" });
  }
  steps.push({ title: "Request indexing in Search Console", detail: "Open the URL in Search Console's URL Inspection and press Request indexing. Google doesn't allow this from an API for regular pages." });
  return {
    summary: status.reason || `Google reports “${status.coverage || "not indexed"}” for this page.`,
    steps,
    model: "Rules",
    generatedAt: new Date().toISOString(),
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────

export async function runAgent(task: StoredTask, config: ClientConfig): Promise<AgentOutput> {
  const origin = `https://${config.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const pageUrl = task.url || (task.path ? `${origin}${task.path}` : null);
  const [home, page] = await Promise.all([
    fetchPage(`${origin}/`),
    pageUrl && task.path !== "/" ? fetchPage(pageUrl) : Promise.resolve(null),
  ]);
  const target = task.path === "/" ? home : page;

  if (task.type === "indexing") return indexingOutput(task, target);

  const about = home.ok ? `${home.title}\n${home.metaDescription}\n${home.text.slice(0, 2500)}` : "";
  let prompt = "";

  switch (task.type) {
    case "ctr": {
      prompt = `${taskBlock(task)}

${pageBlock("The page", target)}

Rewrite this page's title tag and meta description so more searchers click it. The queries above are what people actually searched to see it; the title should make the page obviously the best answer to the biggest of them. Keep the H1 consistent with the new title. Steps should cover where to change it and anything to check after.`;
      break;
    }
    case "onpage": {
      prompt = `${taskBlock(task)}

${pageBlock("The page", target)}

Fix every issue in the evidence. Write a new title, meta description, and H1 if the current ones have problems (otherwise return the current ones unchanged). Write JSON-LD that fits the page: Organization or LocalBusiness (with the right subtype) for the homepage, Service or FAQPage for service pages, Article for posts. Only include properties you can support from the page; use [placeholders] for unknown values like phone or address. Steps should say exactly where each fix goes in Webflow (Page settings fields; JSON-LD goes in Page settings, Custom code, Inside <head> tag, wrapped in <script type="application/ld+json">).`;
      break;
    }
    case "striking": {
      const sitemap = (await sitemapUrls(origin).catch(() => [])).slice(0, 60);
      prompt = `${taskBlock(task)}

${pageBlock("The page", target)}

Other pages on the site:
${list(sitemap.map((u) => u.replace(origin, "") || "/"))}

This page already ranks on page one or two for the keywords above. Write the refresh that gets it into the top 3: a sharper title, meta, and H1 for the lead keyword; 2-4 new sections that cover what the current page is missing for these searches (only things the current page doesn't already say well); 4-6 FAQs people actually ask about this topic; and 2-4 internal links from existing pages (pick real paths from the list) with natural anchor text. Steps should say where each new section goes on the page.`;
      break;
    }
    case "missing_page": {
      const sitemap = (await sitemapUrls(origin).catch(() => [])).slice(0, 80);
      prompt = `${taskBlock(task)}

Pages the site already has:
${list(sitemap.map((u) => u.replace(origin, "") || "/"))}

First check the keyword fits what ${config.name} actually offers (from the homepage above). If it doesn't (it was tracked by mistake, or it's a person's or competitor's name), say so plainly in the summary, return empty strings for the page fields and empty lists, and add one step: remove the keyword from SE Ranking tracking.

Otherwise, write a complete new page that ranks for “${task.keywords?.[0]}” and converts the searcher. Match the search intent (${String(task.data?.intent || "unknown")}). 900-1400 words in bodyHtml, answer-first opening paragraph, scannable H2s, a clear next step that fits the client (contact, quote, consultation, etc.). Don't duplicate an existing page; if one is close, say so in the steps and link to it from the new page. Include FAQs and FAQPage JSON-LD built from them. Steps should cover publishing it in Webflow, linking to it from 2-3 existing pages (name them), and adding it to navigation if it's a core service.`;
      break;
    }
    case "ai_prompt": {
      const ref = task.data?.answerRef as { llmId: number; promptLlmId: number | null; date: string | null } | undefined;
      const siteId = config.integrations.seRanking?.projectId || "";
      let answerBlock = "(The AI's answer text isn't available.)";
      if (ref?.promptLlmId && siteId) {
        const answer = await getAnswer(siteId, ref.llmId, ref.promptLlmId, ref.date || new Date().toISOString().slice(0, 10)).catch(() => null);
        if (answer) {
          answerBlock = `What the AI answered (${answer.date}):
${answer.text.slice(0, 5000)}

Brands it named, in order: ${answer.brands.map((b) => b.name).join(", ") || "(none)"}
Sources it cited: ${answer.sources.map((s) => s.url).slice(0, 12).join(", ") || "(none)"}`;
        }
      }
      const sitemap = (await sitemapUrls(origin).catch(() => [])).slice(0, 80);
      prompt = `${taskBlock(task)}

The prompt people ask AI: “${task.prompt}”

${answerBlock}

Pages the client's site already has:
${list(sitemap.map((u) => u.replace(origin, "") || "/"))}

Make ${config.name} the obvious recommendation for this prompt. Decide whether the content belongs on an existing page (give its path in targetPage) or a new page ('new'). Either way, write the content in newPage.bodyHtml: an opening that directly answers the prompt and names ${config.name} and what it does, then the specifics the AI's answer used to pick the brands it named (and anything it got wrong or left out), written so AI engines can quote it. If it's an existing page, newPage.slug is that page's slug and bodyHtml is the section(s) to add. Include FAQs matching follow-up questions and FAQPage JSON-LD. Steps must include off-site work: which of the cited sources to get ${config.name} listed or mentioned on, and why.`;
      break;
    }
    case "ai_source": {
      const site = await fetchPage(`https://${task.domain}`).catch(() => null);
      const prompts = (task.data?.trackedPrompts as string[]) || [];
      prompt = `${taskBlock(task)}

The site AI engines keep citing: ${task.domain}
${site?.ok ? `What it is (from its homepage): ${site.title}. ${site.metaDescription} ${site.text.slice(0, 1200)}` : "(Couldn't load the site; use what you know about it.)"}

Prompts the client tracks, where this site shows up as a source:
${list(prompts)}

Plan how ${config.name} gets mentioned on ${task.domain}. Work out what kind of site it is (directory, review platform, publication, association, forum, competitor, government) and give the realistic route for that kind of site: claim or create a listing, request inclusion in a roundup, contribute an expert quote or guest post, answer a thread, earn a review, or pitch an editor. Write 1-3 outreach items with ready-to-send messages. If ${task.domain} is a competitor or a site that would never mention another business, say so in the summary and instead give the closest alternative route. Steps should be specific to this site.`;
      break;
    }
    case "ux_leak": {
      prompt = `${taskBlock(task)}

${pageBlock("The page", target)}

Microsoft Clarity shows visitors getting frustrated on this page. From the page's content and structure, work out the most likely causes for each signal (rage clicks usually mean something looks clickable or is slow to respond; dead clicks mean non-link text or images people expect to open; quick backs mean the page didn't match what they expected; error clicks mean broken scripts). Give specific fixes. Steps should include watching 5 Clarity recordings filtered to this page and the signal to confirm before changing anything.`;
      break;
    }
  }

  const schema = SCHEMAS[task.type];
  const { output, model } = await runStructured<Omit<AgentOutput, "model" | "generatedAt">>(system(config, about), prompt, schema);
  // Summaries are meant to be two sentences; keep a runaway one readable.
  const summary = output.summary.length > 600 ? `${output.summary.slice(0, 597).replace(/\s+\S*$/, "")}…` : output.summary;
  return { ...output, summary, model, generatedAt: new Date().toISOString() };
}
