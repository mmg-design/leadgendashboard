// Keeps only the plain formatting tags an agent is allowed to write (and that
// Webflow rich text accepts). Everything else is dropped: scripts, styles,
// event handlers, classes, iframes. Pure string work, safe on client and server.

const ALLOWED = new Set(["h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "b", "em", "i", "a", "blockquote", "br"]);

export function safeHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (tag, name: string, attrs: string) => {
      const n = name.toLowerCase();
      if (!ALLOWED.has(n)) return "";
      if (tag.startsWith("</")) return `</${n}>`;
      if (n === "a") {
        const href = attrs.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] || "";
        return /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(href) ? `<a href="${href.replace(/"/g, "&quot;")}">` : "<a>";
      }
      return `<${n}>`;
    });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function faqHtml(faq: { question: string; answer: string }[]): string {
  if (!faq.length) return "";
  return `<h2>Frequently asked questions</h2>${faq.map((f) => `<h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p>`).join("")}`;
}
