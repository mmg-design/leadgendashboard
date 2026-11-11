// Fonts in the review tool. The proxied page runs sandboxed with an opaque
// origin, and browsers only load a cross-site font when its server sends
// Access-Control-Allow-Origin. Font CDNs (Google Fonts, Webflow, Typekit) do;
// a client's own server often doesn't, so the page falls back to a system
// font. The client's fonts, and the stylesheets that reference them, are
// passed through /api/review/<token>/asset/<path>, which adds that header.
// The path mirrors the file's path on the client's site: a full URL in a
// query string gets these requests blocked by ad blockers.

export const FONT_FILE = /\.(woff2?|ttf|otf|eot)$/i;
export const CSS_FILE = /\.css$/i;

export function assetPath(appOrigin: string, token: string, url: string) {
  const u = new URL(url);
  return `${appOrigin}/api/review/${token}/asset${u.pathname}${u.search}`;
}

function resolve(raw: string, base: URL): URL | null {
  if (/^(data|blob|about|javascript):/i.test(raw.trim())) return null;
  try {
    return new URL(raw.trim(), base);
  } catch {
    return null;
  }
}

// Points the client's font files in a stylesheet through the asset route.
// absolutize: a stylesheet that is itself served from the asset route also
// needs every other url() made absolute, or images would resolve against
// data.mmg.studio instead of the client's site.
export function rewriteCssUrls(
  css: string,
  base: URL,
  opts: { isClient: (u: URL) => boolean; proxy: (u: string) => string; absolutize?: boolean }
) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, raw: string) => {
    const u = resolve(raw, base);
    if (!u) return match;
    if (FONT_FILE.test(u.pathname) && opts.isClient(u)) return `url(${quote}${opts.proxy(u.href)}${quote})`;
    return opts.absolutize ? `url(${quote}${u.href}${quote})` : match;
  }).replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, raw: string) => {
    const u = opts.absolutize ? resolve(raw, base) : null;
    return u ? `@import ${quote}${u.href}${quote}` : match;
  });
}

// In the page itself: inline <style> blocks, the client's stylesheets and
// font preloads.
export function rewriteHtmlAssets(html: string, pageUrl: URL, isClient: (u: URL) => boolean, proxy: (u: string) => string) {
  return html
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open: string, css: string, close: string) =>
      `${open}${rewriteCssUrls(css, pageUrl, { isClient, proxy })}${close}`)
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const rel = tag.match(/\brel\s*=\s*["']?([^"'\s>]+(?:\s+[^"'\s>]+)*)/i)?.[1]?.toLowerCase() || "";
      const href = tag.match(/\bhref\s*=\s*(["'])([^"']+)\1/i);
      if (!href) return tag;
      const u = resolve(href[2], pageUrl);
      if (!u || !isClient(u)) return tag;
      const font = rel.includes("preload") && /\bas\s*=\s*["']?font/i.test(tag) && FONT_FILE.test(u.pathname);
      const sheet = rel.split(/\s+/).includes("stylesheet") && CSS_FILE.test(u.pathname);
      return font || sheet ? tag.replace(href[0], `href=${href[1]}${proxy(u.href)}${href[1]}`) : tag;
    });
}
