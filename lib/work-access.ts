import type { Viewer } from "./viewer";
import type { WorkTask } from "./work-tasks";
import { getMember } from "./team";
import { getConnection, sendEmail } from "./google-oauth";

// Who can see and change a delegated task. The owner sees everything; anyone
// else only the tasks assigned to them.
export const viewerId = (v: Viewer): number | null => (v.type === "member" ? v.member.id : null);

export function canSee(v: Viewer, task: WorkTask): boolean {
  return v.isOwner || (v.type === "member" && task.assigneeId === v.member.id);
}

// Lets the assignee know, when Gmail is connected. Never throws.
export async function notifyAssignee(task: WorkTask, assignedBy: string, origin: string, clientName: string | null) {
  try {
    if (!task.assigneeId || !(await getConnection())) return;
    const member = await getMember(task.assigneeId);
    if (!member || member.status !== "active") return;
    const url = `${origin}/work?task=${task.id}`;
    const where = clientName ? ` for ${clientName}` : "";
    const due = task.dueDate ? ` It's due ${task.dueDate}.` : "";
    await sendEmail({
      to: member.email,
      subject: `New task${where}: ${task.title}`,
      text: `${assignedBy} assigned you a task${where}: ${task.title}.${due}\n\nOpen it: ${url}`,
      html: `<p>${assignedBy} assigned you a task${where}:</p><p style="font-size:16px"><strong>${task.title.replace(/</g, "&lt;")}</strong></p>${due ? `<p>${due.trim()}</p>` : ""}<p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1D475E;color:#fff;text-decoration:none;font-weight:600">Open your queue</a></p>`,
      fromName: "MMG Studio",
    });
  } catch (err) {
    console.error("Task assignment email failed:", err);
  }
}
