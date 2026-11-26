"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Check, Copy, Loader2, Mail, UserPlus } from "lucide-react";
import AccountMenu from "@/components/account-menu";

// Owner-only (the request gate sends everyone else home): invite employees and
// contractors, set job titles, and keep contractor hourly rates.

interface Member {
  id: number;
  email: string;
  name: string;
  title: string;
  kind: "employee" | "contractor";
  isOwner: boolean;
  hourlyRateCents: number | null;
  status: "invited" | "active" | "disabled";
  hasPassword: boolean;
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
}

const field = "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[#0CA4C3]/50 focus:ring-2 focus:ring-[#0CA4C3]/15";
const dollars = (c: number | null) => (c == null ? "" : String(c / 100));
const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [hasOwner, setHasOwner] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ name: string; url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/team");
    const data = await r.json();
    if (!r.ok) return setError(data.error || "Couldn't load the team.");
    setMembers(data.members);
    setTitles(data.titles);
    setHasOwner(data.hasOwner);
  }, []);
  useEffect(() => {
    fetch("/api/team")
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (!ok) return setError(data.error || "Couldn't load the team.");
        setMembers(data.members);
        setTitles(data.titles);
        setHasOwner(data.hasOwner);
      })
      .catch(() => setError("Couldn't load the team."));
  }, []);

  async function call(method: "POST" | "PATCH", body: object) {
    setError(null);
    const r = await fetch("/api/team", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) {
      setError(data.error || "Something went wrong.");
      return null;
    }
    await load();
    return data;
  }

  const showInvite = (name: string, data: { inviteUrl: string; emailed: boolean } | null) => {
    if (data) { setInvite({ name, url: data.inviteUrl, emailed: data.emailed }); setCopied(false); }
  };

  return (
    <div className="min-h-screen bg-[#F3FAFB] text-[#1D475E]">
      <div className="px-4 md:px-8 pt-5">
        <nav className="max-w-[1100px] mx-auto h-[64px] px-4 md:px-5 flex items-center justify-between rounded-2xl bg-white border border-[#1D475E]/[0.08] shadow-[0_1px_4px_rgba(29,71,94,0.06)]">
          <Link href="/" className="flex items-center gap-2.5 text-[15px] font-medium text-[#3E4F5E] hover:text-[#131B30]">
            <ArrowLeft size={16} />
            <Image src="/mmg-icon.png" alt="" width={28} height={28} className="rounded-lg" />
            <span className="hidden sm:inline">All clients</span>
          </Link>
          <AccountMenu />
        </nav>
      </div>

      <main className="max-w-[1100px] mx-auto px-4 md:px-8 py-10 space-y-8">
        <div>
          <h1 className="font-headline text-[34px] md:text-[40px] tracking-tight text-[#131B30]">Team</h1>
          <p className="mt-2 text-[15px] text-[#3E4F5E] max-w-2xl">
            Employees and contractors who sign in with their own email. Only you can add people, change titles and set hourly rates.
            Clients never get an account.
          </p>
        </div>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">{error}</p>}

        {invite && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-900">
            <p className="font-semibold">
              {invite.emailed ? `Invite emailed to ${invite.name}.` : `Invite link for ${invite.name} is ready.`}
              {!invite.emailed && " Gmail isn't connected, so send them this link yourself."}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded bg-white/80 px-2 py-1 text-[12px]">{invite.url}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(invite.url); setCopied(true); }}
                className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[13px] font-medium border border-emerald-200 hover:bg-emerald-100"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        )}

        {!hasOwner && <OwnerSetup onCreate={async (name, email) => showInvite(name, await call("POST", { name, email, isOwner: true }))} />}

        <AddPerson titles={titles} onAdd={async (p) => { const d = await call("POST", p); showInvite(p.name, d); return !!d; }} />

        <section className="rounded-2xl bg-white border border-[#1D475E]/[0.08] shadow-[0_1px_4px_rgba(29,71,94,0.06)] overflow-hidden">
          <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
            <h2 className="text-[17px] font-semibold text-[#131B30]">People</h2>
            <span className="text-[13px] text-muted-foreground">{members ? `${members.filter((m) => m.status !== "disabled").length} active or invited` : ""}</span>
          </div>
          {!members ? (
            <div className="p-6"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : members.length === 0 ? (
            <p className="p-6 text-[14px] text-muted-foreground">No one yet. Add your own owner login first, then invite the team.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="bg-[#F6F9FA] text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Person</th>
                    <th className="px-3 py-2.5 font-medium">Title</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 font-medium">Hourly rate</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Last sign-in</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <MemberRow key={`${m.id}-${m.hourlyRateCents}-${m.kind}`} m={m} titles={titles} onPatch={(patch) => call("PATCH", { id: m.id, ...patch })}
                      onResend={async () => showInvite(m.name, await call("POST", { action: "resend", id: m.id }))} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function OwnerSetup({ onCreate }: { onCreate: (name: string, email: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e: FormEvent) => { e.preventDefault(); setBusy(true); await onCreate(name, email); setBusy(false); }}
      className="rounded-2xl border border-[#0CA4C3]/30 bg-[#0CA4C3]/[0.06] p-5 space-y-3"
    >
      <div>
        <h2 className="text-[17px] font-semibold text-[#131B30]">Create your owner login</h2>
        <p className="text-[14px] text-[#3E4F5E]">You&apos;re signed in with the shared password. Set up your own login first; it&apos;s the only seat that can delegate and see rates.</p>
      </div>
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3">
        <input className={field} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} type="email" placeholder="Your work email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button disabled={busy || !name || !email} className="btn-mmg-blue px-4 py-2.5 text-[15px] disabled:opacity-50">Create owner login</button>
      </div>
    </form>
  );
}

interface NewPerson { name: string; email: string; title: string; kind: "employee" | "contractor"; hourlyRate?: string }

function AddPerson({ titles, onAdd }: { titles: string[]; onAdd: (p: NewPerson) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("Team Member");
  const [kind, setKind] = useState<"employee" | "contractor">("employee");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onAdd({ name, email, title, kind, hourlyRate: kind === "contractor" ? rate : undefined });
        setBusy(false);
        if (ok) { setName(""); setEmail(""); setRate(""); }
      }}
      className="rounded-2xl bg-white border border-[#1D475E]/[0.08] shadow-[0_1px_4px_rgba(29,71,94,0.06)] p-5 space-y-4"
    >
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-[#131B30]"><UserPlus size={17} className="text-[#4AA2C0]" /> Add a person</h2>
      <div className="grid md:grid-cols-2 lg:grid-cols-[1.1fr_1.3fr_1fr_auto_0.8fr] gap-3 items-end">
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted-foreground">Name</span><input className={field} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted-foreground">Email</span><input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-muted-foreground">Title</span>
          <select className={field} value={title} onChange={(e) => setTitle(e.target.value)}>{titles.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <div><span className="mb-1 block text-[12px] font-medium text-muted-foreground">Type</span>
          <div className="inline-flex rounded-lg border border-border bg-[#F6F9FA] p-0.5">
            {(["employee", "contractor"] as const).map((k) => (
              <button type="button" key={k} onClick={() => setKind(k)}
                className={`px-3 py-2 rounded-md text-[14px] capitalize ${kind === k ? "bg-white shadow-sm font-semibold text-[#131B30]" : "text-muted-foreground"}`}>{k}</button>
            ))}
          </div>
        </div>
        <label className={`block ${kind === "contractor" ? "" : "invisible"}`}><span className="mb-1 block text-[12px] font-medium text-muted-foreground">Hourly rate ($)</span>
          <input className={field} inputMode="decimal" placeholder="e.g. 45" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
      </div>
      <button disabled={busy || !name || !email} className="inline-flex items-center gap-1.5 btn-mmg-blue px-4 py-2.5 text-[15px] disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} Send invite
      </button>
    </form>
  );
}

function MemberRow({ m, titles, onPatch, onResend }: { m: Member; titles: string[]; onPatch: (p: object) => Promise<unknown>; onResend: () => void }) {
  const [rate, setRate] = useState(dollars(m.hourlyRateCents));
  const disabled = m.status === "disabled";
  const badge = { invited: "bg-amber-50 text-amber-800 border-amber-200", active: "bg-emerald-50 text-emerald-800 border-emerald-200", disabled: "bg-slate-100 text-slate-600 border-slate-200" }[m.status];
  const small = "rounded-md border border-border bg-white px-2 py-1.5 text-[13px] outline-none focus:border-[#0CA4C3]/50";
  return (
    <tr className={`border-t border-border/60 ${disabled ? "opacity-60" : ""}`}>
      <td className="px-5 py-3">
        <div className="font-semibold text-[#131B30]">{m.name}</div>
        <div className="text-[13px] text-muted-foreground">{m.email}</div>
      </td>
      <td className="px-3 py-3">
        {m.isOwner ? <span className="font-medium">Owner</span> : (
          <select className={small} value={m.title} disabled={disabled} onChange={(e) => onPatch({ title: e.target.value })}>{titles.map((t) => <option key={t}>{t}</option>)}</select>
        )}
      </td>
      <td className="px-3 py-3">
        {m.isOwner ? <span className="capitalize">{m.kind}</span> : (
          <select className={small} value={m.kind} disabled={disabled} onChange={(e) => onPatch({ kind: e.target.value })}>
            <option value="employee">Employee</option><option value="contractor">Contractor</option>
          </select>
        )}
      </td>
      <td className="px-3 py-3">
        {m.kind === "contractor" ? (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">$</span>
            <input className={`${small} w-20`} inputMode="decimal" value={rate} disabled={disabled}
              onChange={(e) => setRate(e.target.value)}
              onBlur={() => rate !== dollars(m.hourlyRateCents) && onPatch({ hourlyRate: rate })} />
            <span className="text-[12px] text-muted-foreground">/hr</span>
          </div>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-3"><span className={`inline-block rounded-full border px-2 py-0.5 text-[12px] font-medium capitalize ${badge}`}>{m.status}</span></td>
      <td className="px-3 py-3 text-[13px] text-muted-foreground">{ago(m.lastLoginAt)}</td>
      <td className="px-5 py-3 text-right whitespace-nowrap">
        {m.status === "invited" && <button onClick={onResend} className="mr-3 text-[13px] font-medium text-[#0394B2] hover:underline">Resend invite</button>}
        {!m.isOwner && (
          <button onClick={() => (disabled || confirm(`Disable ${m.name}? They'll be signed out right away.`)) && onPatch({ status: disabled ? "active" : "disabled" })}
            className={`text-[13px] font-medium hover:underline ${disabled ? "text-[#0394B2]" : "text-red-600"}`}>{disabled ? "Re-enable" : "Disable"}</button>
        )}
      </td>
    </tr>
  );
}
