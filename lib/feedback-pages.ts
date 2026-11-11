import { sitemapUrls } from "./page-fetch";
import { siteOrigin } from "./feedback";

// Every page of a client's site with its own review link, for sending a
// client straight to each page (Client Feedback tab → Page links). Pages come
// from the sitemap; a sitemap that names another host (a staging site listing
// its launch domain) is mapped onto the client's domain, since that's the
// site the review tool shows.

export interface ReviewPage {
  path: string;
  name: string;
  link: string;
}

const words = (slug: string) =>
  decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// "/training/pitching/" → "Training › Pitching"
export function pageName(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts.map(words).join(" › ") : "Home";
}

export async function reviewPages(domain: string, reviewLink: string): Promise<ReviewPage[]> {
  const urls = await sitemapUrls(siteOrigin(domain), 500);
  const paths = new Set<string>();
  for (const u of urls) {
    try {
      const { pathname } = new URL(u);
      if (!/\.(xml|pdf|jpe?g|png|webp|gif|svg|zip)$/i.test(pathname)) paths.add(pathname || "/");
    } catch { /* not a URL */ }
  }
  if (paths.size === 0) paths.add("/");
  return [...paths]
    .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)))
    .map((path) => ({ path, name: pageName(path), link: path === "/" ? reviewLink : `${reviewLink}?page=${encodeURI(path)}` }));
}
