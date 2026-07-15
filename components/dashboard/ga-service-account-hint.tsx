"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";

export function GaServiceAccountHint() {
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/ga/service-account")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setEmail(data?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  if (!email) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-md border border-[#0B4F6C]/15 bg-[#0B4F6C]/[0.04] px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground/80">
      <p className="mb-1">
        Before this works, add this email as a <strong>Viewer</strong> in GA4 → Admin → Property Access Management for this property:
      </p>
      <button
        type="button"
        onClick={handleCopy}
        className="flex w-full items-center justify-between gap-2 rounded border border-[#0B4F6C]/15 bg-white/70 px-2 py-1 font-mono text-[10px] text-[#0B4F6C] hover:bg-white transition-colors"
      >
        <span className="truncate">{email}</span>
        {copied ? <Check size={12} className="shrink-0" /> : <Copy size={12} className="shrink-0" />}
      </button>
    </div>
  );
}
