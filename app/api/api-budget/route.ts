import { NextResponse } from "next/server";
import { getApiBudget } from "@/lib/api-budget";

// Current DataForSEO balance and SE Ranking data units, for the cost warning
// on paid refreshes. Reading both balances is free.
export async function GET() {
  return NextResponse.json(await getApiBudget());
}
