"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, BarChart3, Bot, Loader2, ShieldCheck, Sparkles } from "lucide-react";

// What the product does, framed for healthcare teams. Compliance wording stays
// to what MMG Pulse actually provides (approvals, change history, tracking
// removed from review sessions); no certification claims.
const POINTS = [
  { Icon: Sparkles, title: "Search & AI visibility", text: "See how Google, ChatGPT, and Perplexity rank and recommend you." },
  { Icon: BarChart3, title: "Patient journey analytics", text: "Follow every visit from first search to form fill." },
  { Icon: Bot, title: "Growth agents", text: "Find what's holding the site back and get the fix drafted." },
  { Icon: ShieldCheck, title: "Compliance in the loop", text: "Every change reviewed, approved, and documented. Tracking stays out of reviews." },
];

const AUDIENCES = ["Health systems", "Medicare & insurance", "Pharmacy", "Health tech", "Specialty practices"];

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
    <main className="min-h-screen bg-[#001A2E] grid lg:grid-cols-[1.15fr_1fr]">
      {/* Brand panel */}
      <section className="relative overflow-hidden px-6 py-10 md:px-14 md:py-14 flex flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(12,164,195,0.28),transparent_36%),radial-gradient(circle_at_90%_85%,rgba(3,148,178,0.2),transparent_34%),linear-gradient(150deg,#001A2E_0%,#01384C_60%,#072732_100%)]" />
        <div className="relative flex items-center gap-3">
          <Image src="/mmg-icon.png" alt="MMG" width={38} height={38} className="rounded-lg" />
          <span className="font-headline text-[24px] tracking-tight text-white">MMG Pulse</span>
        </div>
        <div className="relative my-auto py-14 max-w-2xl">
          <div className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#45D7DF] mb-5">Built for healthcare websites</div>
          <h1 className="font-headline text-[clamp(2.5rem,4.4vw,3.9rem)] leading-[1.04] tracking-[-0.03em] text-white">
            The growth platform for healthcare websites.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/70">
            Visibility, patient-journey analytics, and compliant review in one place, for providers, health plans, pharmacies, and health tech.
          </p>
          <ul className="mt-9 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {POINTS.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] border border-white/10">
                  <Icon size={16} className="text-[#45D7DF]" />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold text-white">{title}</span>
                  <span className="block text-[14px] leading-relaxed text-white/65">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-white/45 mr-1">Made for</span>
            {AUDIENCES.map((a) => (
              <span key={a} className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[13px] text-white/75">{a}</span>
            ))}
          </div>
        </div>
        <p className="relative text-[13px] text-white/40">© {new Date().getFullYear()} MMG Pulse · Made by MMG Studio</p>
      </section>

      {/* Sign in */}
      <section className="order-first lg:order-none flex items-center justify-center bg-[#F6F8F9] px-6 py-14 lg:rounded-l-[28px]">
        <div className="w-full max-w-[400px]">
          <h2 className="font-headline text-[34px] tracking-tight text-[#001A2E]">Sign in to MMG Pulse</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">Welcome back. Enter your workspace password to continue.</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-foreground/75">Password</label>
              <input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-border bg-white px-4 py-3.5 text-[16px] outline-none focus:border-[#0CA4C3]/50 focus:ring-2 focus:ring-[#0CA4C3]/15"
              />
            </div>
            {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || !password}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0CA4C3] px-4 py-3.5 text-[15px] font-semibold text-white hover:bg-[#0394B2] disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              {loading ? "Checking…" : "Sign in"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
