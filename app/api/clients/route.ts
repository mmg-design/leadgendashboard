import { NextRequest, NextResponse } from "next/server";
import {
  getAllClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  clientExists,
  type ClientConfig,
} from "@/lib/clients";
import { tokenSites, WebflowError } from "@/lib/webflow";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function GET() {
  const clients = await getAllClients();
  return NextResponse.json({ clients: clients.map(withoutSecrets) });
}

// Replace the Clarity and Webflow tokens with yes/no flags before anything reaches the browser.
function withoutSecrets(client: ClientConfig): ClientConfig {
  const integrations = { ...client.integrations };
  if (integrations.clarity) {
    const { apiToken, ...rest } = integrations.clarity;
    integrations.clarity = { ...rest, hasApiToken: !!apiToken };
  }
  if (integrations.webflow) {
    const { apiToken, ...rest } = integrations.webflow;
    integrations.webflow = { ...rest, hasApiToken: !!apiToken };
  }
  return { ...client, integrations };
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

    const clickupListIds = typeof integrations?.clickup?.listIds === "string"
      ? integrations.clickup.listIds.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean)
      : Array.isArray(integrations?.clickup?.listIds)
      ? integrations.clickup.listIds
      : [];

    const config: Omit<ClientConfig, "goals" | "actionItemsState"> = {
      name,
      slug,
      domain,
      iconUrl: iconUrl || undefined,
      integrations: {
        googleAnalytics: integrations?.googleAnalytics?.enabled
          ? { enabled: true, propertyId: integrations.googleAnalytics.propertyId || "" }
          : undefined,
        clarity: integrations?.clarity?.enabled
          ? {
              enabled: true,
              projectId: integrations.clarity.projectId || "",
              apiToken: integrations.clarity.apiToken || undefined,
            }
          : undefined,
        seRanking: integrations?.seRanking?.enabled
          ? { enabled: true, projectId: integrations.seRanking.projectId || "" }
          : undefined,
        searchConsole: integrations?.searchConsole?.enabled && integrations.searchConsole.property
          ? { enabled: true, property: String(integrations.searchConsole.property).trim() }
          : undefined,
        clickup:
          integrations?.clickup?.enabled && clickupListIds.length > 0
            ? {
                enabled: true,
                listIds: clickupListIds,
                engagementStartDate: integrations.clickup.engagementStartDate || undefined,
              }
            : undefined,
      },
    };

    await createClient(config);

    return NextResponse.json({ client: withoutSecrets({ ...config, goals: [], actionItemsState: { dismissed: [], order: [] } }) }, { status: 201 });
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
    const { slug, name, domain, iconUrl, integrations, goals, actionItemsState } = body;

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    const current = await getClient(slug);
    if (!current) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // The browser never sees the stored Clarity token, so a settings save
    // without a new one keeps the old one instead of wiping it.
    if (integrations?.clarity) {
      const { hasApiToken: _ignored, ...clarity } = integrations.clarity;
      void _ignored;
      if (!clarity.apiToken && current.integrations.clarity?.apiToken) {
        clarity.apiToken = current.integrations.clarity.apiToken;
      }
      integrations.clarity = clarity;
    }

    // Same for Webflow. A newly pasted token is checked against Webflow, and
    // the site it belongs to is stored with it.
    if (integrations?.webflow) {
      const newToken = typeof integrations.webflow.apiToken === "string" ? integrations.webflow.apiToken.trim() : "";
      if (newToken) {
        try {
          const sites = await tokenSites(newToken);
          if (sites.length === 0) return NextResponse.json({ error: "That Webflow token doesn't have access to any site." }, { status: 400 });
          integrations.webflow = { enabled: true, siteId: sites[0].id, siteName: sites[0].displayName, apiToken: newToken };
        } catch (err) {
          const message = err instanceof WebflowError ? err.message : "Couldn't reach Webflow to check the token.";
          return NextResponse.json({ error: message }, { status: 400 });
        }
      } else if (integrations.webflow.enabled === false) {
        integrations.webflow = { enabled: false, siteId: "" }; // disconnect
      } else {
        integrations.webflow = current.integrations.webflow ?? { enabled: false, siteId: "" };
      }
    }

    await updateClient(slug, { name, domain, iconUrl, integrations, goals, actionItemsState });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Client update error:", err);
    return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const slug = req.nextUrl.searchParams.get("slug");

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    if (!(await clientExists(slug))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await deleteClient(slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Client delete error:", err);
    return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
  }
}
