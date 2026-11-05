import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { ghlAuth, listForms, GhlError } from "@/lib/ghl";

// The client's GoHighLevel forms, for the lead-event wizard's form picker.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("client");
  if (!slug) return NextResponse.json({ error: "Missing client param" }, { status: 400 });
  const config = await getClient(slug);
  if (!config) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const auth = ghlAuth(config);
  if (!auth) return NextResponse.json({ connected: false, forms: [] });
  try {
    return NextResponse.json({ connected: true, forms: await listForms(auth.token, auth.locationId) });
  } catch (err) {
    const message = err instanceof GhlError ? err.message : "Couldn't reach GoHighLevel.";
    return NextResponse.json({ connected: true, forms: [], error: message }, { status: 502 });
  }
}
