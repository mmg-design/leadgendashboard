"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { LockKeyhole, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to sign in");
      const requested = new URLSearchParams(window.location.search).get("next");
      const destination = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";
      router.replace(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#001A2E] relative overflow-hidden flex items-center justify-center px-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_5%,rgba(12,164,195,0.24),transparent_34%),radial-gradient(circle_at_92%_30%,rgba(3,148,178,0.18),transparent_30%),linear-gradient(145deg,#001A2E_0%,#01384C_55%,#072732_100%)]" />
      <div className="relative w-full max-w-[420px] rounded-2xl bg-white p-7 md:p-9 shadow-2xl">
        <div className="flex items-center gap-3 mb-7">
          <Image src="/mmg-icon.png" alt="MMG" width={44} height={44} className="rounded-xl" />
          <div><p className="font-headline text-[25px] leading-none text-[#001A2E]">LeadGen Dashboard</p><p className="mt-1 text-[12px] text-muted-foreground">Private client reporting</p></div>
        </div>
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-[#0CA4C3]/10 text-[#0394B2]"><LockKeyhole size={18} /></div>
        <h1 className="font-headline text-[31px] tracking-tight text-[#001A2E]">Enter your password</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">This dashboard contains private client information.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div><label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-foreground/75">Password</label><input id="password" type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-[16px] outline-none focus:border-[#0CA4C3]/50 focus:ring-2 focus:ring-[#0CA4C3]/15" /></div>
          {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
          <button type="submit" disabled={loading || !password} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0CA4C3] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#0394B2] disabled:opacity-50">{loading && <Loader2 size={15} className="animate-spin" />}{loading ? "Checking…" : "Open dashboard"}</button>
        </form>
      </div>
    </main>
  );
}
