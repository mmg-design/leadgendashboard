import { NextRequest, NextResponse } from "next/server";
import { reorderClients } from "@/lib/clients";

export async function POST(req: NextRequest) {
  try {
    const { slugs } = await req.json();

    if (!Array.isArray(slugs) || slugs.some((s) => typeof s !== "string")) {
      return NextResponse.json({ error: "slugs must be an array of strings" }, { status: 400 });
    }

    await reorderClients(slugs);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Client reorder error:", err);
    return NextResponse.json({ error: "Failed to reorder clients" }, { status: 500 });
  }
}
