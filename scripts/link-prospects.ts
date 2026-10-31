// Link prospect research, run from Claude Code on the team's Claude plan
// (the /link-prospects skill in .claude/skills drives it). Claude does the
// thinking; this script reads and writes the dashboard's database.
//
//   npx jiti scripts/link-prospects.ts due                    clients that need research
//   npx jiti scripts/link-prospects.ts context <slug>         everything Claude needs to research one client
//   npx jiti scripts/link-prospects.ts profile <slug> <file>  save Claude's profile draft (never over a team edit)
//   npx jiti scripts/link-prospects.ts add <slug> <file>      add researched prospects
//   npx jiti scripts/link-prospects.ts list <slug>            the ranked list
//
// Reads keys from .env.local. Variables already set win, so
// TURSO_DATABASE_URL=file:./data/clarity-test.db points it at a test database.

import { existsSync, readFileSync } from "node:fs";
import { getAllClients, getClient } from "../lib/clients";
import { cachedBacklinkReport } from "../lib/backlinks";
import {
  addProspects, BACKLOG_TARGET, EFFORT_LABEL, getProfile, listProspects, saveProfile, STAGE_LABEL, type LinkProfile, type ProspectInput,
} from "../lib/link-prospects";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const [cmd, slug, file] = process.argv.slice(2);
const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8"));

async function client(s: string | undefined) {
  const config = s ? await getClient(s) : null;
  if (!config) throw new Error(`No client "${s}". Run "due" to see the slugs.`);
  return config;
}

async function main() {
  if (cmd === "due") {
    const rows = [];
    for (const c of await getAllClients()) {
      const [profile, prospects] = await Promise.all([getProfile(c.slug), listProspects(c.slug)]);
      const notStarted = prospects.filter((p) => p.stage === "not_started").length;
      rows.push({ slug: c.slug, name: c.name, domain: c.domain, hasProfile: !!profile, notStarted, needed: Math.max(0, BACKLOG_TARGET - notStarted) });
    }
    return print(rows);
  }

  if (cmd === "context") {
    const config = await client(slug);
    const [profile, prospects, report] = await Promise.all([getProfile(config.slug), listProspects(config.slug), cachedBacklinkReport(config.slug)]);
    const notStarted = prospects.filter((p) => p.stage === "not_started").length;
    return print({
      client: { slug: config.slug, name: config.name, domain: config.domain },
      profile,
      needed: Math.max(0, BACKLOG_TARGET - notStarted),
      // Never suggest these again, whatever their stage.
      alreadyOnList: prospects.map((p) => ({ domain: p.domain, stage: p.stage })),
      backlinks: report ? {
        fetchedAt: report.fetchedAt,
        authority: report.totals.authority,
        realLinkingSites: report.totals.realRefdomains,
        competitors: report.competitors,
        competitorGap: report.gap,
        strongestLinks: report.best.map((b) => b.domain),
        alreadyLinking: report.linking ?? report.best.map((b) => b.domain),
        mostLinkedPages: report.pages.map((p) => ({ path: p.path, refdomains: p.refdomains, status: p.status })),
      } : "No backlink report yet. Open the client's Links tab once to pull it.",
    });
  }

  if (cmd === "profile") {
    const config = await client(slug);
    if (!file) throw new Error("Give the profile JSON file");
    print(await saveProfile(config.slug, readJson<Partial<LinkProfile>>(file), "Claude"));
    return;
  }

  if (cmd === "add") {
    const config = await client(slug);
    if (!file) throw new Error("Give the prospects JSON file");
    const input = readJson<ProspectInput[] | { prospects: ProspectInput[] }>(file);
    const items = Array.isArray(input) ? input : input.prospects;
    const report = await cachedBacklinkReport(config.slug);
    print(await addProspects(config.slug, config.domain, items, report?.linking ?? []));
    return;
  }

  if (cmd === "list") {
    const config = await client(slug);
    for (const [i, p] of (await listProspects(config.slug)).entries()) {
      console.log(`${String(i + 1).padStart(2)}. [${STAGE_LABEL[p.stage]}] ${EFFORT_LABEL[p.effort]} · fit ${p.fit} · authority ${p.authority} · ${p.domain} — ${p.nextStepLabel} ${p.nextStepUrl}${p.nextStepStatus && p.nextStepStatus >= 400 ? ` (${p.nextStepStatus})` : p.nextStepStatus === null ? " (didn't load)" : ""}`);
    }
    return;
  }

  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//   ")).join("\n"));
}

main().then(() => process.exit(0), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
