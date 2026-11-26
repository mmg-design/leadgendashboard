"use client";

import { useRef, useState } from "react";
import { Building2, Camera, Loader2 } from "lucide-react";

// Team headshots and client logos, shown the same way everywhere.

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";

export function Avatar({ id, name, photoVersion, size = 28, ring = false, title }: {
  id?: number | null; name: string; photoVersion?: string | null; size?: number; ring?: boolean; title?: string;
}) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) };
  const cls = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${ring ? "ring-2 ring-white" : ""}`;
  if (id && photoVersion && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- small versioned avatar from our own API
    return <img src={`/api/team/photo/${id}?v=${photoVersion}`} alt="" title={title ?? name} onError={() => setBroken(true)} className={`${cls} object-cover bg-slate-100`} style={style} />;
  }
  return <span title={title ?? name} className={`${cls} bg-[#1D475E] font-semibold text-white`} style={style}>{initialsOf(name)}</span>;
}

// Overlapping avatars for "who worked on this".
export function AvatarStack({ people, size = 22, max = 4 }: { people: { id: number; name: string; photoVersion?: string | null }[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => <span key={p.id} style={{ marginLeft: i ? -size * 0.3 : 0 }}><Avatar id={p.id} name={p.name} photoVersion={p.photoVersion} size={size} ring /></span>)}
      {people.length > max && <span className="ml-1 text-[12px] text-muted-foreground">+{people.length - max}</span>}
    </span>
  );
}

export function ClientLogo({ logo, name, size = 18 }: { logo?: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (logo && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- small versioned logo from our own API
    return <img src={logo} alt="" title={name} onError={() => setBroken(true)} className="shrink-0 rounded-[5px] object-cover bg-white ring-1 ring-black/5" style={{ width: size, height: size }} />;
  }
  return (
    <span title={name} className="inline-flex shrink-0 items-center justify-center rounded-[5px] bg-[#001A2E]/[0.06]" style={{ width: size, height: size }}>
      <Building2 size={Math.round(size * 0.55)} className="text-[#001A2E]/40" />
    </span>
  );
}

// Center-crops and shrinks a picked photo to a 256px JPEG (roughly 15 KB).
export async function resizePhoto(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new window.Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't an image we can read."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that photo.");
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// An avatar you can click to pick a new photo. `save` gets the resized data URL.
export function PhotoPicker({ id, name, photoVersion, size = 40, save, label = "Change photo" }: {
  id?: number | null; name: string; photoVersion?: string | null; size?: number; save: (image: string) => Promise<void>; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} title={label} aria-label={label}
        className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0CA4C3]">
        <Avatar id={id} name={name} photoVersion={photoVersion} size={size} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          {busy ? <Loader2 size={Math.round(size * 0.4)} className="animate-spin" /> : <Camera size={Math.round(size * 0.4)} />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setBusy(true);
        try { await save(await resizePhoto(file)); } catch (err) { alert(err instanceof Error ? err.message : "Couldn't use that photo."); }
        setBusy(false);
      }} />
    </>
  );
}
