// Webflow Data API v2 with a per-client site token (Site settings, Apps &
// integrations, API access; scopes: sites read/write, pages read/write, CMS
// read/write). Changes are staged; nothing goes live until publishPage /
// publishItems is called, which the dashboard only does on an explicit confirm.

const API = "https://api.webflow.com/v2";

export class WebflowError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function wf<T>(token: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 240);
    try { message = (JSON.parse(text) as { message?: string }).message || message; } catch { /* plain text */ }
    if (res.status === 401) message = "Webflow rejected the API token. Generate a new one in Webflow and paste it in Settings.";
    if (res.status === 403) message = `The Webflow token is missing a permission (${message}). Regenerate it with Sites, Pages, and CMS set to read and write.`;
    if (res.status === 429) message = "Webflow is rate limiting requests. Wait a minute and try again.";
    throw new WebflowError(message, res.status);
  }
  return (res.status === 204 ? {} : await res.json()) as T;
}

export interface WfSite { id: string; displayName: string; shortName: string; customDomains?: { id: string; url: string }[] }
export interface WfPage { id: string; title: string; slug: string; publishedPath?: string; collectionId?: string | null; seo?: { title?: string; description?: string }; archived?: boolean; draft?: boolean }
export interface WfCollection { id: string; displayName: string; singularName: string; slug: string }
export interface WfField { id: string; slug: string; displayName: string; type: string; isRequired: boolean }

export async function tokenSites(token: string): Promise<WfSite[]> {
  return (await wf<{ sites: WfSite[] }>(token, "/sites")).sites || [];
}

export async function siteDomains(token: string, siteId: string) {
  return (await wf<{ customDomains: { id: string; url: string }[] }>(token, `/sites/${siteId}/custom_domains`)).customDomains || [];
}

export async function listPages(token: string, siteId: string): Promise<WfPage[]> {
  const pages: WfPage[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const res = await wf<{ pages: WfPage[]; pagination: { total: number } }>(token, `/sites/${siteId}/pages?limit=100&offset=${offset}`);
    pages.push(...(res.pages || []));
    if (pages.length >= (res.pagination?.total ?? 0) || !res.pages?.length) break;
  }
  return pages;
}

export async function listCollections(token: string, siteId: string): Promise<WfCollection[]> {
  return (await wf<{ collections: WfCollection[] }>(token, `/sites/${siteId}/collections`)).collections || [];
}

export async function collectionFields(token: string, collectionId: string): Promise<WfField[]> {
  return (await wf<{ fields: WfField[] }>(token, `/collections/${collectionId}`)).fields || [];
}

// ── Finding the Webflow object behind a live URL ────────────────────────────

export type WfTarget =
  | { kind: "page"; pageId: string; title: string; seoTitle: string; seoDescription: string }
  | { kind: "item"; collectionId: string; collectionName: string; itemId: string; titleField: string | null; descField: string | null; seoTitle: string; seoDescription: string };

const norm = (p: string) => ("/" + p.replace(/^\/+|\/+$/g, "")).toLowerCase();

// CMS SEO fields have no fixed names; these cover the common conventions
// ("SEO Title", "Meta Title", "Meta Description", "Summary", "Excerpt").
function seoFields(fields: WfField[]) {
  const text = fields.filter((f) => f.type === "PlainText");
  const title = text.find((f) => /(seo|meta).*title|title.*(seo|meta)/i.test(`${f.slug} ${f.displayName}`));
  const desc =
    text.find((f) => /(seo|meta).*desc|desc.*(seo|meta)/i.test(`${f.slug} ${f.displayName}`)) ||
    text.find((f) => /summary|excerpt|description/i.test(`${f.slug} ${f.displayName}`));
  return { titleField: title?.slug || null, descField: desc?.slug || null };
}

export async function findTarget(token: string, siteId: string, path: string): Promise<WfTarget | null> {
  const pages = await listPages(token, siteId);
  const want = norm(path);
  const staticPage = pages.find((p) => !p.collectionId && norm(p.publishedPath || (p.slug ? `/${p.slug}` : "/")) === want)
    || (want === "/" ? pages.find((p) => !p.collectionId && (p.publishedPath === "/" || p.slug === "" || p.slug === "index")) : undefined);
  if (staticPage) {
    return { kind: "page", pageId: staticPage.id, title: staticPage.title, seoTitle: staticPage.seo?.title || "", seoDescription: staticPage.seo?.description || "" };
  }

  // CMS item: the template page's path is the collection prefix, e.g. /blog/{slug}.
  const segments = want.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const itemSlug = segments[segments.length - 1];
  const prefix = norm(segments.slice(0, -1).join("/"));
  const templates = pages.filter((p) => p.collectionId);
  const collections = await listCollections(token, siteId);
  const candidates = templates
    .map((t) => collections.find((c) => c.id === t.collectionId))
    .filter((c): c is WfCollection => !!c)
    .sort((a, b) => Number(norm(b.slug) === prefix) - Number(norm(a.slug) === prefix));
  for (const c of candidates) {
    const res = await wf<{ items: { id: string; fieldData: Record<string, unknown> }[] }>(token, `/collections/${c.id}/items?slug=${encodeURIComponent(itemSlug)}&limit=1`);
    const item = res.items?.[0];
    if (!item) continue;
    const { titleField, descField } = seoFields(await collectionFields(token, c.id));
    return {
      kind: "item",
      collectionId: c.id,
      collectionName: c.displayName,
      itemId: item.id,
      titleField,
      descField,
      seoTitle: titleField ? String(item.fieldData[titleField] || "") : "",
      seoDescription: descField ? String(item.fieldData[descField] || "") : "",
    };
  }
  return null;
}

// ── Writes (staged, not published) ──────────────────────────────────────────

export async function updatePageSeo(token: string, pageId: string, seo: { title: string; description: string }) {
  await wf(token, `/pages/${pageId}`, {
    method: "PUT",
    body: { seo, openGraph: { titleCopied: true, descriptionCopied: true } },
  });
}

export async function updateItemFields(token: string, collectionId: string, itemId: string, fieldData: Record<string, string>) {
  await wf(token, `/collections/${collectionId}/items/${itemId}`, { method: "PATCH", body: { fieldData } });
}

// Creates a draft CMS item. Name and slug always map; the body goes to the
// collection's first rich-text field, and title/description go to fields that
// look like SEO fields when the collection has them.
export async function createDraftItem(
  token: string,
  collectionId: string,
  draft: { name: string; slug: string; bodyHtml: string; seoTitle: string; metaDescription: string }
): Promise<{ itemId: string; mapped: string[]; unmappedRequired: string[] }> {
  const fields = await collectionFields(token, collectionId);
  const fieldData: Record<string, unknown> = { name: draft.name, slug: draft.slug };
  const mapped = ["name", "slug"];
  const rich = fields.find((f) => f.type === "RichText");
  if (rich) { fieldData[rich.slug] = draft.bodyHtml; mapped.push(rich.displayName); }
  const { titleField, descField } = seoFields(fields);
  if (titleField) { fieldData[titleField] = draft.seoTitle; mapped.push(titleField); }
  if (descField && descField !== titleField) { fieldData[descField] = draft.metaDescription; mapped.push(descField); }
  const unmappedRequired = fields
    .filter((f) => f.isRequired && !(f.slug in fieldData) && f.slug !== "name" && f.slug !== "slug")
    .map((f) => f.displayName);
  const res = await wf<{ id: string }>(token, `/collections/${collectionId}/items`, {
    method: "POST",
    body: { isDraft: true, isArchived: false, fieldData },
  });
  return { itemId: res.id, mapped, unmappedRequired };
}

// ── Publish (only after the user confirms in the dashboard) ─────────────────

export async function publishPage(token: string, siteId: string, pageId: string) {
  const domains = await siteDomains(token, siteId);
  await wf(token, `/sites/${siteId}/publish`, {
    method: "POST",
    body: { pageId, ...(domains.length ? { customDomains: domains.map((d) => d.id) } : { publishToWebflowSubdomain: true }) },
  });
}

export async function publishItems(token: string, collectionId: string, itemIds: string[]) {
  await wf(token, `/collections/${collectionId}/items/publish`, { method: "POST", body: { itemIds } });
}
