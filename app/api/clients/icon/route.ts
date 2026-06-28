import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { clientExists, updateClient } from "@/lib/clients";

const MAX_ICON_BYTES = 15 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};
const FILE_EXTENSIONS: Record<string, string> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
  svg: "svg",
};
function getIconExtension(file: File): string | null {
  const mimeExtension = MIME_EXTENSIONS[file.type.toLowerCase()];
  if (mimeExtension) return mimeExtension;

  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? FILE_EXTENSIONS[extension] || null : null;
}

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

    const extension = getIconExtension(icon);
    if (!extension) {
      return NextResponse.json(
        { error: "Use a PNG, JPG, WebP, GIF, or SVG image." },
        { status: 400 }
      );
    }

    if (icon.size > MAX_ICON_BYTES) {
      return NextResponse.json({ error: "Icon must be 15MB or smaller." }, { status: 400 });
    }

    const bytes = Buffer.from(await icon.arrayBuffer());
    const normalizedIcon = await sharp(bytes, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize(512, 512, {
        fit: "cover",
        position: "center",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    const iconUrl = `data:image/webp;base64,${normalizedIcon.toString("base64")}`;
    await updateClient(slug, { iconUrl });

    return NextResponse.json({ iconUrl });
  } catch (err) {
    console.error("Client icon upload error:", err);
    return NextResponse.json({ error: "Failed to upload icon" }, { status: 500 });
  }
}
