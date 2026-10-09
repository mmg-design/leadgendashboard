import { NextRequest, NextResponse } from "next/server";
import { getClient, type ClientConfig } from "@/lib/clients";
import { getTask, updateTask, type StoredTask } from "@/lib/agent-tasks";
import type { AgentOutput } from "@/lib/agent-runner";
import { GscError, resolveProperty, resubmitSitemaps } from "@/lib/gsc";
import { faqHtml, safeHtml } from "@/lib/safe-html";
import {
  WebflowError,
  createDraftItem,
  findTarget,
  listCollections,
  publishItems,
  publishPage,
  updateItemFields,
  updatePageSeo,
} from "@/lib/webflow";

// Every way an agent's draft leaves the dashboard. Each action runs only when
// the user presses its button; Webflow changes are staged until "publish".

type Body = {
  client?: string;
  key?: string;
  action?: "webflow_lookup" | "webflow_seo" | "webflow_draft" | "webflow_publish" | "clickup" | "resubmit_sitemap";
  title?: string;
  description?: string;
  collectionId?: string;
  name?: string;
  slug?: string;
};

function webflowAuth(config: ClientConfig) {
  const wf = config.integrations.webflow;
  return wf?.enabled && wf.apiToken && wf.siteId ? { token: wf.apiToken, siteId: wf.siteId } : null;
}

function taskMarkdown(task: StoredTask, out: AgentOutput | null, dashboardUrl: string) {
  const lines = [`**Why:** ${task.why}`, "", "**Evidence**", ...task.evidence.map((e) => `- ${e}`)];
  if (out) {
    lines.push("", "**Agent's draft**", out.summary);
    if (out.seo?.title) lines.push("", `- Title: ${out.seo.title}`, `- Meta description: ${out.seo.metaDescription}`, `- H1: ${out.seo.h1}`);
    if (out.steps?.length) lines.push("", "**Steps**", ...out.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? `: ${s.detail}` : ""}`));
  }
  lines.push("", `Full draft in the dashboard: ${dashboardUrl}`);
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const { client: slug, key, action } = body;
  if (!slug || !key || !action) return NextResponse.json({ error: "Missing client, key, or action" }, { status: 400 });
  const [config, task] = await Promise.all([getClient(slug), getTask(slug, key)]);
  if (!config || !task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const out = task.output as AgentOutput | null;
  const result = { ...(task.result || {}) };

  try {
    switch (action) {
      // Read-only: what Webflow object this page is, and the CMS collections.
      case "webflow_lookup": {
        const auth = webflowAuth(config);
        if (!auth) return NextResponse.json({ connected: false });
        const [target, collections] = await Promise.all([
          task.path ? findTarget(auth.token, auth.siteId, task.path) : Promise.resolve(null),
          listCollections(auth.token, auth.siteId),
        ]);
        return NextResponse.json({ connected: true, siteName: config.integrations.webflow?.siteName, target, collections });
      }

      case "webflow_seo": {
        const auth = webflowAuth(config);
        if (!auth || !task.path) return NextResponse.json({ error: "Connect Webflow in Settings first." }, { status: 400 });
        const title = (body.title || out?.seo?.title || "").trim();
        const description = (body.description || out?.seo?.metaDescription || "").trim();
        if (!title || !description) return NextResponse.json({ error: "Title and description are required." }, { status: 400 });
        const target = await findTarget(auth.token, auth.siteId, task.path);
        if (!target) return NextResponse.json({ error: `Couldn't find ${task.path} in the Webflow site. Copy the text into Page settings by hand.` }, { status: 404 });
        if (target.kind === "page") {
          await updatePageSeo(auth.token, target.pageId, { title, description });
        } else {
          if (!target.titleField && !target.descField) {
            return NextResponse.json({ error: `${task.path} is a ${target.collectionName} CMS item with no SEO title or description field. Copy the text into the collection's SEO settings by hand.` }, { status: 400 });
          }
          await updateItemFields(auth.token, target.collectionId, target.itemId, {
            ...(target.titleField ? { [target.titleField]: title } : {}),
            ...(target.descField ? { [target.descField]: description } : {}),
          });
        }
        result.webflow = { ...target, previous: { title: target.seoTitle, description: target.seoDescription }, applied: { title, description }, appliedAt: new Date().toISOString(), published: false };
        await updateTask(slug, key, { status: "applied", result });
        return NextResponse.json({ ok: true, result });
      }

      case "webflow_draft": {
        const auth = webflowAuth(config);
        if (!auth) return NextResponse.json({ error: "Connect Webflow in Settings first." }, { status: 400 });
        if (!out?.newPage?.bodyHtml || !body.collectionId) return NextResponse.json({ error: "Run the agent and pick a collection first." }, { status: 400 });
        const slugValue = (body.slug || out.newPage.slug || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        const draft = await createDraftItem(auth.token, body.collectionId, {
          name: (body.name || out.seo?.h1 || out.seo?.title || task.title).trim(),
          slug: slugValue,
          bodyHtml: safeHtml(out.newPage.bodyHtml) + faqHtml(out.faq || []),
          seoTitle: (body.title || out.seo?.title || "").trim(),
          metaDescription: (body.description || out.seo?.metaDescription || "").trim(),
        });
        result.draft = { ...draft, collectionId: body.collectionId, createdAt: new Date().toISOString() };
        await updateTask(slug, key, { status: "applied", result });
        return NextResponse.json({ ok: true, result });
      }

      // Goes live. The dashboard asks for confirmation before calling this.
      case "webflow_publish": {
        const auth = webflowAuth(config);
        const applied = result.webflow as { kind: string; pageId?: string; collectionId?: string; itemId?: string } | undefined;
        if (!auth || !applied) return NextResponse.json({ error: "Nothing staged to publish." }, { status: 400 });
        if (applied.kind === "page" && applied.pageId) await publishPage(auth.token, auth.siteId, applied.pageId);
        else if (applied.collectionId && applied.itemId) await publishItems(auth.token, applied.collectionId, [applied.itemId]);
        result.webflow = { ...applied, published: true, publishedAt: new Date().toISOString() };
        await updateTask(slug, key, { status: "done", result });
        return NextResponse.json({ ok: true, result });
      }

      case "clickup": {
        const apiKey = process.env.CLICKUP_API_KEY;
        const listId = config.integrations.clickup?.enabled ? config.integrations.clickup.listIds?.[0] : null;
        if (!apiKey || !listId) return NextResponse.json({ error: "ClickUp isn't connected for this client." }, { status: 400 });
        const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: task.title,
            markdown_description: taskMarkdown(task, out, `${req.nextUrl.origin}/${slug}`),
            priority: task.impact === "high" ? 2 : task.impact === "medium" ? 3 : 4,
            tags: ["agent"],
          }),
        });
        if (!res.ok) return NextResponse.json({ error: `ClickUp ${res.status}: ${(await res.text()).slice(0, 160)}` }, { status: 502 });
        const created = (await res.json()) as { id: string; url: string };
        result.clickup = { id: created.id, url: created.url, createdAt: new Date().toISOString() };
        await updateTask(slug, key, { result });
        return NextResponse.json({ ok: true, result });
      }

      case "resubmit_sitemap": {
        const property = await resolveProperty(config).catch(() => null);
        if (!property) return NextResponse.json({ error: "Search Console isn't connected for this client." }, { status: 400 });
        const submitted = await resubmitSitemaps(property, `https://${config.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`);
        result.sitemap = { submitted, at: new Date().toISOString() };
        await updateTask(slug, key, { result });
        return NextResponse.json({ ok: true, result });
      }
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof WebflowError) return NextResponse.json({ error: err.message }, { status: 502 });
    if (err instanceof GscError) {
      const message = err.kind === "no_access" ? "Resubmitting needs Full permission for the service account in Search Console." : err.message;
      return NextResponse.json({ error: message }, { status: 502 });
    }
    console.error("Agent apply error:", err);
    return NextResponse.json({ error: "That didn't work. Try again." }, { status: 500 });
  }
}
