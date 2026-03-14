import { NextRequest, NextResponse } from "next/server";
import {
  getAllClients,
  createClient,
  clientExists,
  type ClientConfig,
} from "@/lib/clients";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function GET() {
  const clients = await getAllClients();
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, domain, integrations } = body;

    if (!name || !domain) {
      return NextResponse.json(
        { error: "Name and domain are required" },
        { status: 400 }
      );
    }

    const slug = toSlug(name);

    if (await clientExists(slug)) {
      return NextResponse.json(
        { error: "A client with this name already exists" },
        { status: 409 }
      );
    }

    const config: ClientConfig = {
      name,
      slug,
      domain,
      integrations: {
        googleAnalytics: integrations?.googleAnalytics?.enabled
          ? {
              enabled: true,
              propertyId: integrations.googleAnalytics.propertyId || "",
            }
          : undefined,
        vector: integrations?.vector?.enabled
          ? {
              enabled: true,
              webhookEnabled: true,
              siteId: integrations.vector.siteId || "",
            }
          : undefined,
        snitcher: integrations?.snitcher?.enabled
          ? {
              enabled: true,
              webhookEnabled: true,
              projectId: integrations.snitcher.projectId || "",
            }
          : undefined,
        clarity: integrations?.clarity?.enabled
          ? {
              enabled: true,
              projectId: integrations.clarity.projectId || "",
            }
          : undefined,
      },
    };

    await createClient(config);

    return NextResponse.json({ client: config }, { status: 201 });
  } catch (err) {
    console.error("Client creation error:", err);
    return NextResponse.json(
      { error: "Failed to create client" },
      { status: 500 }
    );
  }
}
