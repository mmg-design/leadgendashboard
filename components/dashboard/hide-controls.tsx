"use client";

import { Eye, EyeOff } from "lucide-react";

// Row-level hide/unhide for the Overview lists. Hidden items are saved on the
// client, so they disappear for everyone; "Show hidden" brings them back.

export function HideButton({ hidden, label, onClick }: { hidden: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={hidden ? `Show ${label} again` : `Hide ${label}`}
      aria-label={hidden ? `Show ${label} again` : `Hide ${label}`}
      className={`shrink-0 rounded-md p-1 text-[#097388]/60 hover:bg-muted/60 hover:text-[#001A2E] transition-opacity ${hidden ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"}`}
    >
      {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
    </button>
  );
}

export function HiddenFooter({ count, noun, showing, onToggle }: { count: number; noun: string; showing: boolean; onToggle: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-[#097388]/80 hover:text-[#001A2E]"
    >
      {showing ? <EyeOff size={13} /> : <Eye size={13} />}
      {showing ? "Hide them again" : `${count} hidden ${noun}${count === 1 ? "" : "s"} · Show`}
    </button>
  );
}
