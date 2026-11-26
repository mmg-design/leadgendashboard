import type { Viewer } from "./viewer";
import { isMentioned, type WorkStatus, type WorkTask } from "./work-tasks";
import { getMember, listMembers, type TeamMember } from "./team";
import { getConnection, sendEmail } from "./google-oauth";

// Who can see and change a delegated task, and who gets emailed about it.

export const viewerId = (v: Viewer): number | null => (v.type === "member" ? v.member.id : null);

// The owner sees everything; anyone else the tasks assigned to them.
export function canSee(v: Viewer, task: WorkTask): boolean {
  return v.isOwner || (v.type === "member" && task.assigneeId === v.member.id);
}

// Also lets in people @mentioned on the task, so the link in their email works.
export async function canAccess(v: Viewer, task: WorkTask): Promise<boolean> {
  return canSee(v, task) || (v.type === "member" && (await isMentioned(task.id, v.member.id)));
}

const STATUS_LABEL: Record<WorkStatus, string> = { todo: "To do", in_progress: "In progress", review: "In review", done: "Done" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const button = (url: string, label: string) =>
  `<p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1D475E;color:#fff;text-decoration:none;font-weight:600">${label}</a></p>`;

async function mail(to: string, subject: string, text: string, html: string) {
  try {
    if (!(await getConnection())) return;
    await sendEmail({ to, subject, text, html, fromName: "MMG Studio" });
  } catch (err) {
    console.error("Work email failed:", err);
  }
}

// The owner's inbox: their own login's email, or the connected Gmail account.
async function ownerEmail(): Promise<string | null> {
  const owner = (await listMembers()).find((m) => m.isOwner && m.status === "active");
  if (owner) return owner.email;
  return (await getConnection().catch(() => null))?.email || null;
}

const where = (clientName: string | null) => (clientName ? ` (${clientName})` : "");

// Lets the assignee know. Never throws.
export async function notifyAssignee(task: WorkTask, assignedBy: string, origin: string, clientName: string | null) {
  if (!task.assigneeId) return;
  const member = await getMember(task.assigneeId);
  if (!member || member.status !== "active") return;
  const url = `${origin}/work?task=${task.id}`;
  const due = task.dueDate ? ` It's due ${task.dueDate}.` : "";
  await mail(member.email, `New task${where(clientName)}: ${task.title}`,
    `${assignedBy} assigned you a task${where(clientName)}: ${task.title}.${due}\n\nOpen it: ${url}`,
    `<p>${esc(assignedBy)} assigned you a task${esc(where(clientName))}:</p><p style="font-size:16px"><strong>${esc(task.title)}</strong></p>${due ? `<p>${due.trim()}</p>` : ""}${button(url, "Open your queue")}`);
}

// Emails everyone @mentioned in a comment (except the author). Never throws.
export async function notifyMentions(task: WorkTask, memberIds: number[], author: { id: number | null; name: string }, body: string, origin: string, clientName: string | null) {
  const url = `${origin}/work?task=${task.id}`;
  const people: TeamMember[] = [];
  for (const id of new Set(memberIds)) {
    if (id === author.id) continue;
    const m = await getMember(id);
    if (m && m.status === "active") people.push(m);
  }
  await Promise.all(people.map((m) => mail(m.email, `${author.name} mentioned you on: ${task.title}`,
    `${author.name} mentioned you on "${task.title}"${where(clientName)}:\n\n${body}\n\nOpen it: ${url}`,
    `<p>${esc(author.name)} mentioned you on <strong>${esc(task.title)}</strong>${esc(where(clientName))}:</p><blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #0CA4C3;background:#F3FAFB;white-space:pre-line">${esc(body)}</blockquote>${button(url, "Open the task")}`)));
}

// Keeps the owner in the loop on status changes and comments by anyone else. Never throws.
export async function notifyOwner(
  event: { kind: "status"; from: WorkStatus; to: WorkStatus } | { kind: "comment"; body: string },
  task: WorkTask, actor: { name: string; isOwner: boolean }, origin: string, clientName: string | null,
) {
  if (actor.isOwner) return;
  const to = await ownerEmail();
  if (!to) return;
  const url = `${origin}/work?task=${task.id}`;
  if (event.kind === "status") {
    const line = `${actor.name} moved "${task.title}"${where(clientName)} from ${STATUS_LABEL[event.from]} to ${STATUS_LABEL[event.to]}.`;
    await mail(to, `${STATUS_LABEL[event.to]}: ${task.title}${where(clientName)}`, `${line}\n\nOpen it: ${url}`, `<p>${esc(line)}</p>${button(url, "Open the task")}`);
  } else {
    await mail(to, `${actor.name} commented on: ${task.title}`,
      `${actor.name} commented on "${task.title}"${where(clientName)}:\n\n${event.body}\n\nOpen it: ${url}`,
      `<p>${esc(actor.name)} commented on <strong>${esc(task.title)}</strong>${esc(where(clientName))}:</p><blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #0CA4C3;background:#F3FAFB;white-space:pre-line">${esc(event.body)}</blockquote>${button(url, "Open the task")}`);
  }
}
