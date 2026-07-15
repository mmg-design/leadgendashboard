import { NextResponse } from "next/server";
import { getGoogleServiceAccountEmail } from "@/lib/google-service-account";

export async function GET() {
  const email = getGoogleServiceAccountEmail();
  if (!email) {
    return NextResponse.json({ error: "No Google credentials configured" }, { status: 404 });
  }
  return NextResponse.json({ email });
}
