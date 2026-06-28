import { NextRequest, NextResponse } from "next/server";

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

async function raw(path: string, apiKey: string) {
  const res = await fetch(`${CLICKUP_BASE}${path}`, {
    headers: { Authorization: apiKey },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ok: res.ok, body: json };
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.CLICKUP_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No CLICKUP_API_KEY" }, { status: 503 });

  const workspaceId = "9014892899";
  const startMs = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const endMs = Date.now();
  const sampleTaskId = "86bab722h"; // On-page Recommendation — known to have time entries

  const [
    noFilter,
    withAssigneeArray,
    withAssigneesPlural,
    withComma,
    taskLevel,
    spaceFilter,
  ] = await Promise.allSettled([
    raw(`/team/${workspaceId}/time_entries?start_date=${startMs}&end_date=${endMs}`, apiKey),
    raw(`/team/${workspaceId}/time_entries?start_date=${startMs}&end_date=${endMs}&assignee[]=94896237&assignee[]=156203094&assignee[]=61642649&assignee[]=111946575`, apiKey),
    raw(`/team/${workspaceId}/time_entries?start_date=${startMs}&end_date=${endMs}&assignees[]=94896237&assignees[]=156203094&assignees[]=61642649&assignees[]=111946575`, apiKey),
    raw(`/team/${workspaceId}/time_entries?start_date=${startMs}&end_date=${endMs}&assignee=94896237,156203094,61642649,111946575`, apiKey),
    raw(`/task/${sampleTaskId}/time_entries?start_date=${startMs}&end_date=${endMs}`, apiKey),
    raw(`/team/${workspaceId}/time_entries?start_date=${startMs}&end_date=${endMs}&space_id=90145653817`, apiKey),
  ]);

  const summarize = (r: PromiseSettledResult<{ status: number; ok: boolean; body: unknown }>) => {
    if (r.status === "rejected") return { error: String(r.reason) };
    const d = r.value;
    const entries = (d.body as any)?.data?.length ?? "n/a";
    const err = (d.body as any)?.err ?? null;
    return { httpStatus: d.status, entries, err, sample: JSON.stringify(d.body).slice(0, 300) };
  };

  return NextResponse.json({
    startMs,
    endMs,
    results: {
      noFilter: summarize(noFilter),
      assigneeBrackets: summarize(withAssigneeArray),
      assigneesPluralBrackets: summarize(withAssigneesPlural),
      assigneeComma: summarize(withComma),
      perTask: summarize(taskLevel),
      spaceId: summarize(spaceFilter),
    },
  });
}
