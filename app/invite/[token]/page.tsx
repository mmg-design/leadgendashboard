"use client";

import { FormEvent, use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, Loader2 } from "lucide-react";

// Where a new team member lands from their invite email: set a password, then in.
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [invite, setInvite] = useState<{ name: string; email: string; title: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "This invite link isn't valid.");
        setInvite(data);
      })
      .catch((err) => setLoadError(err.message));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError("The two passwords don't match.");
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Couldn't set your password.");
      router.replace(data.isOwner ? "/" : "/work");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set your password.");
      setSaving(false);
    }
  }

  const input = "w-full rounded-xl border border-border bg-white px-4 py-3.5 text-[16px] outline-none focus:border-[#0CA4C3]/50 focus:ring-2 focus:ring-[#0CA4C3]/15";

  return (
    <main className="min-h-screen bg-[#F6F8F9] flex items-center justify-center px-4 py-14">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center gap-2.5 mb-10">
          <Image src="/mmg-icon.png" alt="MMG" width={34} height={34} className="rounded-lg" />
          <span className="text-[21px] font-semibold tracking-[-0.02em] text-[#131B30]">MMG Studio</span>
        </div>
        {loadError ? (
          <>
            <h1 className="font-headline text-[30px] tracking-tight text-[#001A2E]">Invite link expired</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{loadError}</p>
          </>
        ) : !invite ? (
          <Loader2 className="animate-spin text-muted-foreground" />
        ) : (
          <>
            <h1 className="font-headline text-[32px] tracking-tight text-[#001A2E]">Welcome, {invite.name.split(" ")[0]}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
              You&apos;re joining as <strong className="text-foreground">{invite.title}</strong>. Set a password for {invite.email}.
            </p>
            <form onSubmit={submit} className="mt-8 space-y-4">
              <input type="email" value={invite.email} autoComplete="username" readOnly hidden />
              <div>
                <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-foreground/75">Password (at least 10 characters)</label>
                <input id="password" type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1.5 block text-[13px] font-medium text-foreground/75">Confirm password</label>
                <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
              </div>
              {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={saving || password.length < 10 || !confirm}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0CA4C3] px-4 py-3.5 text-[15px] font-semibold text-white hover:bg-[#0394B2] disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                {saving ? "Saving…" : "Set password and sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
