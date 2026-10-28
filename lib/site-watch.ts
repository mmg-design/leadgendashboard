import { getDb } from "./db";
import type { ClientConfig } from "./clients";
import { sitemapUrls } from "./page-fetch";
import { normalizePath } from "./page-behavior";
import { siteInfo } from "./webflow";
import { recordEvent } from "./site-events";

// Daily check for changes made to a client's site outside MMG Pulse: pages
// added to or dropped from the sitemap, and Webflow publishes. The first run
// only records a baseline; history starts from there.

const CHECK_EVERY_HOURS = 20;
// A sitemap change bigger than this (a migration, a CMS import) becomes one
// event listing the pages instead of one marker per page.
const BULK = 15;

async function readState(slug: string, key: string) {
  const db = await getDb();
  const r = await db.execute({ sql: "SELECT data, fetched_at FROM analytics_cache WHERE client_slug = ? AND metric_type = ? AND date_range = 'latest'", args: [slug, key] });
  return r.rows[0] ? { data: JSON.parse(r.rows[0].data as string), at: r.rows[0].fetched_at as string } : null;
}
async function writeState(slug: string, key: string, data: unknown) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (client_slug, metric_type, date_range, data, fetched_at) VALUES (?, ?, 'latest', ?, datetime('now'))`,
    args: [slug, key, JSON.stringify(data)],
  });
}

const pathOf = (u: string) => { try { return normalizePath(new URL(u).pathname); } catch { return null; } };

async function checkSitemap(slug: string, config: ClientConfig) {
  const origin = `https://${config.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const urls = await sitemapUrls(origin, 5000);
  if (urls.length === 0) return; // unreachable or no sitemap: keep the old baseline
  const now = new Set(urls.map(pathOf).filter((p): p is string => !!p));
  const prev = await readState(slug, "sitemap_snapshot");
  await writeState(slug, "sitemap_snapshot", [...now]);
  if (!prev) return;

  const before = new Set<string>(prev.data);
  const added = [...now].filter((p) => !before.has(p));
  const removed = [...before].filter((p) => !now.has(p));
  const today = new Date().toISOString().slice(0, 10);

  if (added.length > BULK) {
    await recordEvent(slug, { kind: "page_added", title: `${added.length} pages added to the sitemap`, pages: added, source: "Sitemap", ref: `added:bulk:${today}` });
  } else {
    for (const p of added) await recordEvent(slug, { kind: "page_added", title: `New page: ${p}`, pages: [p], source: "Sitemap", ref: `added:${p}` });
  }
  if (removed.length > BULK) {
    await recordEvent(slug, { kind: "page_removed", title: `${removed.length} pages removed from the sitemap`, pages: removed, source: "Sitemap", ref: `removed:bulk:${today}` });
  } else {
    for (const p of removed) await recordEvent(slug, { kind: "page_removed", title: `Page removed: ${p}`, pages: [p], source: "Sitemap", ref: `removed:${p}:${today}` });
  }
}

async function checkWebflow(slug: string, config: ClientConfig) {
  const wf = config.integrations.webflow;
  if (!wf?.enabled || !wf.apiToken || !wf.siteId) return;
  const site = await siteInfo(wf.apiToken, wf.siteId);
  if (!site.lastPublished) return;
  const prev = await readState(slug, "webflow_published");
  await writeState(slug, "webflow_published", site.lastPublished);
  if (!prev || prev.data === site.lastPublished) return;
  await recordEvent(slug, {
    kind: "site_published",
    title: `Site published in Webflow`,
    detail: `${site.displayName} was published to the live site.`,
    source: "Webflow",
    ref: `webflow:${site.lastPublished}`,
    occurredAt: site.lastPublished,
  });
}

// Runs at most every CHECK_EVERY_HOURS per client (the daily cron, or the
// first dashboard visit of the day when the cron hasn't run).
export async function checkSiteChanges(slug: string, config: ClientConfig, force = false) {
  const last = await readState(slug, "site_watch");
  if (!force && last && Date.now() - new Date(`${last.at.replace(" ", "T")}Z`).getTime() < CHECK_EVERY_HOURS * 3_600_000) return;
  await writeState(slug, "site_watch", { at: new Date().toISOString() });
  await Promise.allSettled([checkSitemap(slug, config), checkWebflow(slug, config)]).then((rs) =>
    rs.forEach((r) => r.status === "rejected" && console.error(`Site check failed for ${slug}:`, r.reason))
  );
}
