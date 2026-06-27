import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { clientExists, updateClient } from "@/lib/clients";

const MAX_ICON_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const slug = formData.get("slug");
    const icon = formData.get("icon");

    if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: "Invalid client slug" }, { status: 400 });
    }

    if (!(await clientExists(slug))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (!(icon instanceof File)) {
      return NextResponse.json({ error: "Icon image is required" }, { status: 400 });
    }

    const extension = MIME_EXTENSIONS[icon.type];
    if (!extension) {
      return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
    }

    if (icon.size > MAX_ICON_BYTES) {
      return NextResponse.json({ error: "Icon must be 5MB or smaller" }, { status: 400 });
    }

    const bytes = Buffer.from(await icon.arrayBuffer());
    const clientDir = path.join(process.cwd(), "public", "clients", slug);
    await mkdir(clientDir, { recursive: true });

    await Promise.all(
      Object.values(MIME_EXTENSIONS).map((ext) =>
        rm(path.join(clientDir, `icon.${ext}`), { force: true })
      )
    );

    const fileName = `icon.${extension}`;
    await writeFile(path.join(clientDir, fileName), bytes);

    const iconUrl = `/clients/${slug}/${fileName}?v=${Date.now()}`;
    await updateClient(slug, { iconUrl });

    return NextResponse.json({ iconUrl });
  } catch (err) {
    console.error("Client icon upload error:", err);
    return NextResponse.json({ error: "Failed to upload icon" }, { status: 500 });
  }
}
