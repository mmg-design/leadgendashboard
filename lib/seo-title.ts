// CMS templates often wrap the SEO title field in a brand suffix, e.g.
// "{{Meta Title}} – Exact Benefits". Given the full title the agent wrote,
// returns what goes in the field (brand removed so it isn't doubled) and what
// searchers will actually see.

export type TitleAffix = { before: string; after: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const core = (s: string) => s.replace(/^[\s|–—:-]+|[\s|–—:-]+$/g, "").trim();

export function fitTitle(title: string, affix: TitleAffix | null | undefined) {
  let field = title.trim();
  const after = core(affix?.after || "");
  const before = core(affix?.before || "");
  if (after) field = field.replace(new RegExp(`\\s*[|–—:-]\\s*${esc(after)}\\s*$`, "i"), "");
  if (before) field = field.replace(new RegExp(`^\\s*${esc(before)}\\s*[|–—:-]\\s*`, "i"), "");
  return { field, rendered: `${affix?.before || ""}${field}${affix?.after || ""}`.replace(/\s{2,}/g, " ").trim() };
}
