---
name: link-prospects
description: Research link-building prospects for MMG Pulse clients and add them to the dashboard's Links tab. Use when asked to find backlink prospects, top up a client's link list, run link research, or "/link-prospects" with or without a client slug. Runs on the Claude plan in Claude Code; nothing here calls the Anthropic API.
---

# Link prospect research

The Links tab in MMG Pulse shows each client a ranked list of sites worth a
link, easiest first, with a next-step link and a ready pitch. You do the
research here; `scripts/link-prospects.ts` reads and writes the database.
Run every command from the repo root (`~/Documents/leadgendashboard`).

## 1. Pick the clients

- Given a slug: research that client.
- No slug: run `npx jiti scripts/link-prospects.ts due` and research every
  client whose `needed` is above 0, one at a time.

## 2. Load the client

`npx jiti scripts/link-prospects.ts context <slug>` prints the client, its
link profile, how many prospects are `needed`, every domain `alreadyOnList`
(never suggest one again, whatever its stage) and the backlink report:
authority, competitors, the competitor gap, and `alreadyLinking` (skip those
too). If there is no backlink report, say so and continue without it.

## 3. The link profile

If `profile` is null, draft one. Read the client's site first: the homepage,
about, services, locations and contact pages, and `/sitemap.xml` for the page
list. Write a JSON file with these string fields, each plain sentences, no
marketing language:

- `business`: what it does and what sets it apart
- `customers`: who buys and what they look for
- `area`: where it serves (cities, counties, states)
- `relationships`: partners, carriers, vendors, associations, sponsorships,
  sister companies the site mentions
- `pages`: which pages links should point at, as `/path — use for ...` lines
- `avoid`: anything to stay away from (for example health claims)

Save it: `npx jiti scripts/link-prospects.ts profile <slug> <file>`. If the
team has edited the profile, the command refuses; that's expected. Use the
team's version as written; it outranks anything you find on the site.

## 4. Research prospects

Find `needed` prospects (at most 15 in one run). Each must be a real
organisation that would plausibly link to this client because of who the
client is, not a generic SEO list. Mix the sources:

- **Local**: chamber of commerce and business associations in the client's
  area (member directories), local news and community calendars, community
  organisations, local event sponsorships
- **Partner**: the client's existing relationships from the profile:
  vendor, carrier or software "find a partner/agent" pages, sister companies
- **Industry**: associations and directories that matter in the client's
  field, resource pages that list businesses like this one, podcasts
- **Press**: journalist-request platforms and outlets that quote experts
- **Competitor link**: domains from `competitorGap` that fit the profile

Use WebSearch to find candidates, then open the page where the next step
happens (WebFetch) and confirm it is real and current: a membership or
listing form, a partner application, a submission page, or a contact page
with the right person. `nextStepUrl` must be that page, not a homepage,
unless the homepage is the only way in.

Leave out: paid link schemes, link exchanges, private blog networks,
"write for us" content farms, spammy directories, sites that already link to
the client, the client's own sites, and anything the profile says to avoid.

For each prospect decide:

- `effort`: `easy` is a form, listing or existing relationship; `medium` is
  an email pitch to a person; `hard` is an editorial piece, a feature or a
  guest article
- `fit`: 3 is the client's exact customers or area, 2 is adjacent, 1 is a
  general but credible site
- `targetPage`: the client page from the profile that the link should point to

Then write the pitch the client (or MMG on their behalf) would send:
`pitchSubject`, `pitchBody` under 120 words, and `followUp` under 60 words
for 5 to 7 days later. Make them specific to that site; mention what it
publishes or who it serves. Use `[brackets]` for anything you don't know,
like `[Your name]`. For a form-based prospect, write what to put in the form
as `pitchBody` and leave `pitchSubject` empty. No compliance or
certification claims (no "HIPAA compliant", no rankings promises).

## 5. Save

Write a JSON array of objects with exactly these fields:

```json
{
  "domain": "westervillechamber.com",
  "name": "Westerville Area Chamber of Commerce",
  "kind": "local",
  "effort": "easy",
  "fit": 3,
  "why": "One or two sentences on why this site, for this client.",
  "targetPage": "/",
  "nextStepUrl": "https://westervillechamber.com/membership",
  "nextStepLabel": "Join and get a member listing",
  "contact": "Membership Director, membership@... (only if public)",
  "pitchSubject": "",
  "pitchBody": "",
  "followUp": ""
}
```

`kind` is one of `local`, `partner`, `industry`, `press`, `resource`,
`podcast`, `community`, `competitor_gap`.

Run `npx jiti scripts/link-prospects.ts add <slug> <file>`. It skips
duplicates and dead next-step links, looks up authority in SE Ranking, and
syncs the Agents queue. If it skipped some and the client is still short of
5 not started, research replacements.

Finish with `npx jiti scripts/link-prospects.ts list <slug>` and report what
was added, in a few lines per client. Keep scratch JSON files in your
scratchpad, not the repo.
