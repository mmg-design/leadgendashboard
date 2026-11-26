"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ListChecks } from "lucide-react";
import AccountMenu from "@/components/account-menu";
import AgentQueue from "@/components/agent-queue";

// The agent queue: every client's latest recommendations in one place, to
// assign to the team or hand to an agent.
export default function QueuePage() {
  return (
    <div className="min-h-screen page-wash text-[#1D475E]">
      <div className="px-4 md:px-8 pt-5">
        <nav className="max-w-[1240px] mx-auto h-[64px] px-4 md:px-5 flex items-center justify-between rounded-2xl card-depth">
          <Link href="/#clients" className="flex items-center gap-2.5 text-[15px] font-medium text-[#3E4F5E] hover:text-[#131B30]">
            <ArrowLeft size={16} />
            <Image src="/mmg-icon.png" alt="" width={28} height={28} className="rounded-lg" />
            <span className="hidden sm:inline">All clients</span>
          </Link>
          <AccountMenu />
        </nav>
      </div>
      <main className="max-w-[1240px] mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-headline text-[34px] md:text-[40px] tracking-tight text-[#131B30]">Agent queue</h1>
            <p className="mt-1 max-w-2xl text-[15px] text-[#3E4F5E]">
              The latest recommendations from every client&apos;s agents. Assign one to the team with extra context, or have an agent draft the fix.
              Nothing changes on a client&apos;s site until someone applies it.
            </p>
          </div>
          <Link href="/work" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2.5 text-[15px] font-medium shadow-[0_1px_2px_rgba(7,61,143,0.06),0_3px_8px_rgba(7,61,143,0.05)] transition-all duration-200 hover:shadow-[0_1px_2px_rgba(7,61,143,0.08),0_6px_14px_rgba(7,61,143,0.08)]">
            <ListChecks size={16} /> Work board
          </Link>
        </div>
        <AgentQueue />
      </main>
    </div>
  );
}
