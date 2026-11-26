"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, LogOut, Users } from "lucide-react";

export interface Me { type: "member" | "legacy"; name: string; title?: string; email?: string; isOwner: boolean }

// One request per page load, shared by the account menu and owner-only controls.
let mePromise: Promise<Me | null> | null = null;
function loadMe(): Promise<Me | null> {
  mePromise ??= fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return mePromise;
}

// Who's signed in, or null while loading. Use it to hide owner-only controls.
export function useViewer(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { loadMe().then(setMe); }, []);
  return me;
}

// Who's signed in, with the owner's Team link and Sign out. Sits in the page headers.
export default function AccountMenu() {
  const router = useRouter();
  const me = useViewer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!me) return null;
  const initials = me.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    mePromise = null;
    router.replace("/login");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={me.name}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1D475E] text-[13px] font-semibold text-white hover:bg-[#163a4d]"
      >
        {initials || "?"}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-60 rounded-xl border border-border bg-white p-1.5 shadow-lg">
          <div className="px-3 py-2 border-b border-border/60 mb-1">
            <div className="text-[14px] font-semibold text-[#131B30] truncate">{me.name}</div>
            <div className="text-[12px] text-muted-foreground truncate">
              {me.type === "legacy" ? "Shared workspace password" : `${me.title}${me.email ? ` · ${me.email}` : ""}`}
            </div>
          </div>
          <Link href="/work" role="menuitem" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-[#1D475E] hover:bg-[#F3FAFB]">
            <ListChecks size={15} /> {me.isOwner ? "Work" : "My queue"}
          </Link>
          {me.isOwner && (
            <Link href="/team" role="menuitem" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-[#1D475E] hover:bg-[#F3FAFB]">
              <Users size={15} /> Team and rates
            </Link>
          )}
          <button onClick={signOut} role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-[#1D475E] hover:bg-[#F3FAFB]">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
