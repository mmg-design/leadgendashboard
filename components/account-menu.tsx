"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, ListChecks, LogOut, Users } from "lucide-react";
import TimerPill from "@/components/timer";
import { Avatar, PhotoPicker } from "@/components/avatar";

export interface Me { type: "member" | "legacy"; id?: number; name: string; title?: string; email?: string; isOwner: boolean; photoVersion?: string | null }

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
  const loaded = useViewer();
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const me = loaded && photo !== undefined ? { ...loaded, photoVersion: photo } : loaded;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!me) return null;

  async function savePhoto(image: string | null) {
    const r = await fetch("/api/auth/me/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Couldn't save your photo.");
    setPhoto(data.photoVersion ?? null);
    mePromise = null; // other components pick up the new photo on their next load
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    mePromise = null;
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
    {me.type === "member" && <TimerPill />}
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={me.name}
        className="rounded-full transition-transform duration-300 hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0CA4C3]"
      >
        <Avatar id={me.id} name={me.name} photoVersion={me.photoVersion} size={36} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-64 rounded-xl card-depth p-1.5 anim-pop">
          <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border/60 mb-1">
            {me.type === "member" ? (
              <PhotoPicker id={me.id} name={me.name} photoVersion={me.photoVersion} size={44} save={savePhoto} label={me.photoVersion ? "Change your photo" : "Add a photo"} />
            ) : <Avatar name={me.name} size={44} />}
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-[#131B30] truncate">{me.name}</div>
              <div className="text-[12px] text-muted-foreground truncate">
                {me.type === "legacy" ? "Shared workspace password" : `${me.title}${me.email ? ` · ${me.email}` : ""}`}
              </div>
              {me.type === "member" && (
                me.photoVersion
                  ? <button onClick={() => savePhoto(null).catch(() => {})} className="text-[12px] font-medium text-[#0394B2] hover:underline">Remove photo</button>
                  : <span className="text-[12px] text-[#0394B2]">Click the circle to add a headshot</span>
              )}
            </div>
          </div>
          <Link href="/work" role="menuitem" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-[#1D475E] hover:bg-[#F3FAFB] transition-colors duration-200">
            <ListChecks size={15} /> {me.isOwner ? "Work" : "My queue"}
          </Link>
          {(me.isOwner || me.type === "member") && (
            <Link href="/time" role="menuitem" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-[#1D475E] hover:bg-[#F3FAFB] transition-colors duration-200">
              <Clock size={15} /> {me.isOwner ? "Time reports" : "My time"}
            </Link>
          )}
          {me.isOwner && (
            <Link href="/team" role="menuitem" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-[#1D475E] hover:bg-[#F3FAFB] transition-colors duration-200">
              <Users size={15} /> Team and rates
            </Link>
          )}
          <button onClick={signOut} role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[14px] text-[#1D475E] hover:bg-[#F3FAFB] transition-colors duration-200">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
    </div>
  );
}
