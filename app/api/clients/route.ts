import { NextRequest, NextResponse } from "next/server";
import {
  getAllClients,
  createClient,
  updateClient,
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
    const { name, domain, iconUrl, integrations } = body;

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
      iconUrl: iconUrl || undefined,
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
              workspaceId: integrations.snitcher.workspaceId || "",
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

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { slug, name, iconUrl, integrations } = body;

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    if (!(await clientExists(slug))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await updateClient(slug, { name, iconUrl, integrations });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Client update error:", err);
    return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
  }
}
