import fs from "node:fs";
import path from "node:path";

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export function extensionFromMime(mime: string): string | null {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}

export async function saveEntityImage(input: {
  file: File;
  folder: "categories" | "products";
  entityId: number;
}): Promise<string> {
  const ext = extensionFromMime(input.file.type);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported image type");
  }

  const uploadDir = path.join(
    process.cwd(),
    "public",
    "uploads",
    input.folder,
  );
  fs.mkdirSync(uploadDir, { recursive: true });

  const fileName = `${input.entityId}.${ext}`;
  const diskPath = path.join(uploadDir, fileName);
  const buffer = Buffer.from(await input.file.arrayBuffer());
  fs.writeFileSync(diskPath, buffer);

  return `/uploads/${input.folder}/${fileName}`;
}
