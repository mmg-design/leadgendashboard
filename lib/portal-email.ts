import type { PortalReport } from "./portal";

// The monthly update as a plain note from the account manager, drafted from
// the same report the client page uses (hidden items already removed). It's
// only shown in the team's Client Page tab and saved to their own Gmail
// drafts, so it reads like a person wrote it: no template blocks, no branding.

const n = (v: number) => v.toLocaleString("en-US");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const sentence = (s: string) => (/[.!?”"]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const list = (parts: string[]) => (parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`);

export function composeUpdate(report: PortalReport, opts: { contactName: string | null; senderName: string | null; link: string | null }) {
  const month = report.periods.find((p) => p.key === "month");
  const generated = new Date(report.generatedAt);
  // Early in a month, the last 30 days are mostly the month before.
  const monthName = new Date(generated.getFullYear(), generated.getMonth() - (generated.getDate() <= 10 ? 1 : 0), 15).toLocaleDateString("en-US", { month: "long" });
  const first = opts.contactName?.trim().split(/\s+/)[0] || "";
  const lines: string[] = [`Hi${first ? ` ${first}` : ""},`, "", `Wanted to send a quick update on how the website did over the last month.`];

  const numbers: string[] = [];
  if (month?.found) {
    const who = month.found.label.includes("Google") ? "people found you through Google search" : "people visited the website";
    numbers.push(`${n(month.found.value)} ${who}${month.found.pct != null && month.found.pct >= 5 ? ` (up ${month.found.pct}% from the month before)` : ""}`);
  }
  if (month?.leads) {
    const up = month.leads.pct != null && month.leads.pct >= 5 ? `, up ${month.leads.pct}%` : "";
    numbers.push(month.leads.kind === "contact"
      ? `your contact page had ${n(month.leads.value)} ${month.leads.value === 1 ? "visit" : "visits"}${up}`
      : `the site brought in ${n(month.leads.value)} new ${month.leads.value === 1 ? "lead" : "leads"}${up}`);
  }
  const para: string[] = [];
  if (numbers.length) para.push(`Over the last 30 days, ${list(numbers)}.`);
  if (month?.pageOne && month.pageOne.gained && month.pageOne.gained > 0) {
    para.push(`You're now on the first page of Google for ${month.pageOne.value} of the searches we track, ${month.pageOne.gained} more than a month ago.`);
  }
  if (month?.value) para.push(`At your average lead value, that's roughly $${n(month.value)} in potential revenue.`);
  if (para.length) lines.push("", para.join(" "));

  const since = new Date(generated.getTime() - 35 * 86_400_000).toISOString().slice(0, 10);
  const wins = report.wins.filter((w) => w.day >= since).slice(0, 3);
  if (wins.length) {
    lines.push("", "A few things worth calling out:");
    for (const w of wins) lines.push(`- ${sentence(w.title)}`);
  }

  const work = report.changes.filter((c) => c.kind !== "request" && c.day >= since).slice(0, 4);
  if (work.length) {
    lines.push("", "What we worked on:");
    for (const c of work) {
      const result = c.result?.tone === "good" ? ` (${lower(c.result.text)})` : c.result?.tone === "wait" ? " (we'll know how it's doing in a couple of weeks)" : "";
      lines.push(`- ${c.title}${result}`);
    }
  }

  const done = report.requests.filter((r) => r.status === "resolved" && r.day >= since).slice(0, 3);
  if (done.length) {
    lines.push("", done.length === 1 ? `We also took care of your request: “${done[0].body}”` : `We also took care of ${done.length} of your requests, including “${done[0].body}”`);
  }

  if (opts.link) lines.push("", `If you want to dig into the details, everything's here: ${opts.link}`);
  lines.push("", "Let me know if you have any questions, or if there's anything you'd like us to focus on next.");
  const signer = opts.senderName?.trim().split(/\s+/)[0];
  if (signer) lines.push("", signer);

  return { subject: `${monthName} website update`, body: lines.join("\n") };
}
