import type { ClientConfig } from "./clients";
import type { StoredTask } from "./agent-tasks";
import type { AgentOutput } from "./agent-runner";
import { faqHtml, safeHtml } from "./safe-html";
import { WebflowError, findTarget, getItem, updateItemFields, updatePageSeo, type WfTarget } from "./webflow";

// Turns an agent's draft into the exact list of Webflow changes it implies,
// checked against the live Webflow site: which page or CMS item, which field,
// what it says now, and what it will say. Changes the Data API can make are
// marked auto; the rest say where to make them by hand. Nothing is written
// until the user picks changes and presses Stage, and nothing goes live until
// they publish.

export type PlanOpId = "seo" | "h1" | "jsonld" | "content" | "links";

export interface PlanOp {
  id: PlanOpId;
  label: string;
  where: string;
  changes: { field: string; before: string; after: string }[];
  auto: boolean;
  // Checked by default. Off for longer copy that deserves a read first.
  recommended: boolean;
  manual?: string;
  copy?: string;
}

export interface WebflowPlan {
  builtAt: string;
  siteName: string | null;
  target: { kind: "page" | "item"; label: string } | null;
  problem: string | null;
  ops: PlanOp[];
}

const PLAN_TYPES = new Set(["ctr", "onpage", "striking", "ai_prompt"]);

export function planApplies(task: StoredTask, out: AgentOutput | null) {
  if (!out || !task.path || !PLAN_TYPES.has(task.type)) return false;
  return !(task.type === "ai_prompt" && (!out.targetPage || out.targetPage === "new"));
}

function auth(config: ClientConfig) {
  const wf = config.integrations.webflow;
  return wf?.enabled && wf.apiToken && wf.siteId ? { token: wf.apiToken, siteId: wf.siteId } : null;
}

function webflowProblem(err: unknown): string {
  if (err instanceof WebflowError && err.status === 403 && /cms/i.test(err.message)) {
    return "The Webflow token can't read CMS items, so it can't edit blog posts. In Webflow: Site settings, Apps & integrations, API access, generate a new token with CMS read and write (plus Sites and Pages read and write), then paste it in this client's Settings.";
  }
  return err instanceof Error ? err.message : "Couldn't reach Webflow.";
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const words = (html: string) => (text(html) ? text(html).split(" ").length : 0);
const h1s = (html: string) => [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => text(m[1]));

// Agent sections are plain text with "- " list items; Webflow rich text wants HTML.
function sectionHtml(sections: { heading: string; body: string }[]) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return sections.map((s) => {
    const blocks = s.body.split(/\n{2,}/).map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => l.startsWith("- "))) return `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join("")}</ul>`;
      return `<p>${esc(lines.join(" "))}</p>`;
    });
    return `<h2>${esc(s.heading)}</h2>${blocks.join("")}`;
  }).join("");
}

function newContent(task: StoredTask, out: AgentOutput) {
  if (task.type === "ai_prompt") return out.newPage?.bodyHtml ? safeHtml(out.newPage.bodyHtml) + faqHtml(out.faq || []) : "";
  return sectionHtml(out.sections || []) + faqHtml(out.faq || []);
}

function prettyJson(raw: string): string | null {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return null; }
}

function targetLabel(t: WfTarget, path: string) {
  return t.kind === "page" ? `Static page “${t.title}” (${path})` : `${t.collectionName} CMS item “${t.itemName}”`;
}

export async function buildPlan(task: StoredTask, out: AgentOutput, config: ClientConfig): Promise<WebflowPlan | null> {
  if (!planApplies(task, out)) return null;
  const path = task.path!;
  const creds = auth(config);
  let target: WfTarget | null = null;
  let problem: string | null = null;
  let body = "";
  let schemaNow = "";

  if (!creds) {
    problem = "Webflow isn't connected for this client. Add a site API token in Settings to let the agent make these changes.";
  } else {
    try {
      target = await findTarget(creds.token, creds.siteId, path);
      if (!target) problem = `Couldn't find ${path} in the Webflow site.`;
      if (target?.kind === "item") {
        const item = await getItem(creds.token, target.collectionId, target.itemId);
        body = target.richField ? String(item.fieldData[target.richField] || "") : "";
        schemaNow = target.schemaField ? String(item.fieldData[target.schemaField] || "") : "";
      }
    } catch (err) {
      problem = webflowProblem(err);
    }
  }

  const item = target?.kind === "item" ? target : null;
  const page = target?.kind === "page" ? target : null;
  const name = (slug: string | null) => (item && slug ? item.fieldNames[slug] || slug : "");
  const ops: PlanOp[] = [];

  // Title tag and meta description.
  if (out.seo?.title) {
    const before = { title: target?.seoTitle ?? "", description: target?.seoDescription ?? "" };
    const changes: PlanOp["changes"] = [];
    if (out.seo.title !== before.title) changes.push({ field: "Title tag", before: before.title, after: out.seo.title });
    if (out.seo.metaDescription && out.seo.metaDescription !== before.description) changes.push({ field: "Meta description", before: before.description, after: out.seo.metaDescription });
    if (changes.length) {
      const itemFields = item ? [item.titleField && `“${name(item.titleField)}”`, item.descField && `“${name(item.descField)}”`].filter(Boolean).join(" and ") : "";
      const auto = !!page || !!(item && (item.titleField || item.descField));
      ops.push({
        id: "seo",
        label: changes.length === 2 ? "Rewrite the title tag and meta description" : changes[0].field === "Title tag" ? "Rewrite the title tag" : "Rewrite the meta description",
        where: page ? "Page settings, SEO" : item ? (itemFields ? `${item.collectionName} item, ${itemFields} field${itemFields.includes(" and ") ? "s" : ""}` : `${item.collectionName} item`) : "Page settings, SEO",
        changes,
        auto,
        recommended: true,
        manual: item && !auto
          ? `The ${item.collectionName} collection has no SEO title or description field, so the template is probably using the post name. Add “SEO Title” and “Meta Description” plain-text fields to the collection and bind them in the template's SEO settings once; after that this is automatic.`
          : item && (!item.titleField || !item.descField)
          ? `Only the ${item.titleField ? "title" : "description"} has a field in this collection; the other one needs a field added before it can be set.`
          : undefined,
        copy: `${out.seo.title}\n${out.seo.metaDescription}`,
      });
    }
  }

  // Extra or missing H1s, when the scan flagged them.
  const h1Evidence = task.evidence.find((e) => /\bH1\b/.test(e));
  if (h1Evidence) {
    const inBody = h1s(body);
    if (/no h1/i.test(h1Evidence)) {
      ops.push({
        id: "h1", label: "Add an H1", where: item ? `${item.collectionName} template, in the Designer` : "The page, in the Designer", changes: [{ field: "H1", before: "(none)", after: out.seo?.h1 || "" }],
        auto: false, recommended: false,
        manual: `In the Designer, set the page's main heading to H1${out.seo?.h1 ? ` with the text “${out.seo.h1}”` : ""}.`,
        copy: out.seo?.h1,
      });
    } else if (item && item.richField && inBody.length) {
      ops.push({
        id: "h1",
        label: `Turn the ${inBody.length === 1 ? "H1" : `${inBody.length} H1s`} inside the post body into H2${inBody.length === 1 ? "" : "s"}`,
        where: `${item.collectionName} item, “${name(item.richField)}” field`,
        changes: inBody.map((t) => ({ field: "Heading level", before: `H1: ${t}`, after: `H2: ${t}` })),
        auto: true,
        recommended: true,
        manual: "The template's own title stays the page's only H1.",
      });
    } else {
      ops.push({
        id: "h1", label: "Keep one H1 on the page", where: item ? `${item.collectionName} template, in the Designer` : "The page, in the Designer", changes: [],
        auto: false, recommended: false,
        manual: item
          ? `The extra H1 isn't in this post's body; it's on the ${item.collectionName} template. In the Designer, open the template, select the second H1 and change its tag to H2. That fixes every post at once.`
          : "In the Designer, select the second H1 and change its tag to H2 (Heading settings, Tag).",
      });
    }
  }

  // Structured data.
  const jsonld = out.schemaJsonLd?.trim() ? prettyJson(out.schemaJsonLd) : null;
  if (out.schemaJsonLd?.trim()) {
    const types = jsonld ? [...jsonld.matchAll(/"@type":\s*"([^"]+)"/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i).slice(0, 4).join(", ") : "";
    const tag = `<script type="application/ld+json">\n${jsonld || out.schemaJsonLd}\n</script>`;
    if (!jsonld) {
      ops.push({ id: "jsonld", label: "Add structured data (JSON-LD)", where: "Page settings, Custom code", changes: [], auto: false, recommended: false, manual: "The agent's JSON-LD isn't valid JSON. Run the agent again before adding it.", copy: out.schemaJsonLd });
    } else if (item?.schemaField) {
      ops.push({
        id: "jsonld", label: `Add ${types || "structured data"} JSON-LD`, where: `${item.collectionName} item, “${name(item.schemaField)}” field`,
        changes: [{ field: name(item.schemaField), before: schemaNow.trim() ? "Existing JSON-LD (will be replaced)" : "(empty)", after: `${types} JSON-LD, ${jsonld.split("\n").length} lines` }],
        auto: true, recommended: true, copy: jsonld,
      });
    } else {
      ops.push({
        id: "jsonld", label: `Add ${types || "structured data"} JSON-LD`, where: item ? `${item.collectionName} template, Custom code` : "Page settings, Custom code, Inside <head> tag",
        changes: [], auto: false, recommended: false,
        manual: item
          ? `One-time setup so the agent can do this for every post: add a plain-text field called “Schema JSON-LD” to the ${item.collectionName} collection, then on the ${item.collectionName} template open Page settings, Custom code, Inside <head> tag, and add <script type="application/ld+json"> + that field + </script>. Until then, paste this into the page's head code by hand.`
          : "Webflow's API can only add JavaScript to a page's custom code, not JSON-LD, so paste this into Page settings, Custom code, Inside <head> tag, then publish.",
        copy: tag,
      });
    }
  }

  // New sections and FAQs.
  const added = newContent(task, out);
  if (added) {
    const n = task.type === "ai_prompt" ? 0 : out.sections?.length || 0;
    const f = out.faq?.length || 0;
    const what = task.type === "ai_prompt" ? "the new answer-first section" : [n && `${n} new section${n === 1 ? "" : "s"}`, f && `${f} FAQs`].filter(Boolean).join(" and ");
    ops.push({
      id: "content",
      label: `Add ${what} to the end of the ${item ? "post" : "page"}`,
      where: item?.richField ? `${item.collectionName} item, “${name(item.richField)}” field` : "The page, in the Designer",
      changes: [{ field: "Body", before: body ? `${words(body).toLocaleString()} words` : "", after: `+${words(added).toLocaleString()} words` }],
      auto: !!item?.richField,
      recommended: false,
      manual: item?.richField
        ? "Appended after the existing text; nothing already there is changed. Read it above before staging."
        : "Copy on a static page lives in the Designer, so these sections need to be placed by hand.",
      copy: text(added) ? added : undefined,
    });
  }

  if (out.internalLinks?.length) {
    ops.push({
      id: "links", label: `Add ${out.internalLinks.length} internal link${out.internalLinks.length === 1 ? "" : "s"} to this page`, where: "The linking pages",
      changes: out.internalLinks.map((l) => ({ field: l.fromPage, before: "", after: `“${l.anchorText}” → ${path}` })),
      auto: false, recommended: false,
      manual: "Each link goes on a different page; open each one and link the words shown.",
    });
  }

  return {
    builtAt: new Date().toISOString(),
    siteName: config.integrations.webflow?.siteName || null,
    target: target ? { kind: target.kind, label: targetLabel(target, path) } : null,
    problem,
    // Without a working connection nothing can be automatic.
    ops: target ? ops : ops.map((o) => ({ ...o, auto: false })),
  };
}

// Stages the chosen changes in Webflow (one write per page or item). Returns
// what was there before so the dashboard can show it, and the target for publish.
export async function applyPlan(
  task: StoredTask,
  out: AgentOutput,
  config: ClientConfig,
  opIds: PlanOpId[],
  edits: { title?: string; description?: string }
) {
  const creds = auth(config);
  if (!creds || !task.path) throw new WebflowError("Connect Webflow in Settings first.", 400);
  const target = await findTarget(creds.token, creds.siteId, task.path).catch((err) => { throw new WebflowError(webflowProblem(err), 502); });
  if (!target) throw new WebflowError(`Couldn't find ${task.path} in the Webflow site.`, 404);
  const want = new Set(opIds);
  const title = (edits.title || out.seo?.title || "").trim();
  const description = (edits.description || out.seo?.metaDescription || "").trim();
  const applied: PlanOpId[] = [];

  if (target.kind === "page") {
    if (want.has("seo") && title && description) {
      await updatePageSeo(creds.token, target.pageId, { title, description });
      applied.push("seo");
    }
    return { target, applied, previous: { title: target.seoTitle, description: target.seoDescription }, previousFields: {} };
  }

  const item = await getItem(creds.token, target.collectionId, target.itemId);
  const fieldData: Record<string, string> = {};
  const previousFields: Record<string, string> = {};
  const set = (slug: string, value: string) => { previousFields[slug] ??= String(item.fieldData[slug] ?? ""); fieldData[slug] = value; };

  if (want.has("seo")) {
    if (target.titleField && title) set(target.titleField, title);
    if (target.descField && description) set(target.descField, description);
    if (target.titleField || target.descField) applied.push("seo");
  }
  if (target.richField && (want.has("h1") || want.has("content"))) {
    let body = String(item.fieldData[target.richField] || "");
    if (want.has("h1") && /<h1/i.test(body)) {
      body = body.replace(/<h1(\s[^>]*)?>/gi, "<h2$1>").replace(/<\/h1>/gi, "</h2>");
      applied.push("h1");
    }
    const added = want.has("content") ? newContent(task, out) : "";
    if (added) { body += added; applied.push("content"); }
    if (applied.includes("h1") || applied.includes("content")) set(target.richField, body);
  }
  if (want.has("jsonld") && target.schemaField && out.schemaJsonLd) {
    const json = prettyJson(out.schemaJsonLd);
    if (json) { set(target.schemaField, json); applied.push("jsonld"); }
  }
  if (Object.keys(fieldData).length) await updateItemFields(creds.token, target.collectionId, target.itemId, fieldData);
  return { target, applied, previous: { title: target.seoTitle, description: target.seoDescription }, previousFields };
}
