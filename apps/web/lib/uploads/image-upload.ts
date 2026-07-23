import { MAX_HERO_SIZE, MAX_IMAGE_SIZE, MAX_LOGO_SIZE } from "@louez/validations";

export const IMAGE_UPLOAD_KINDS = ["avatar", "logo", "hero", "product", "inspection"] as const;

export type ImageUploadKind = (typeof IMAGE_UPLOAD_KINDS)[number];

export const IMAGE_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type ImageUploadIssue = "invalidType" | "tooLarge";

export const IMAGE_UPLOAD_CONFIG = {
  avatar: { folder: null, maxSize: MAX_LOGO_SIZE },
  logo: { folder: "logo", maxSize: MAX_LOGO_SIZE },
  // Keep hero images in the existing logo folder for backward compatibility.
  hero: { folder: "logo", maxSize: MAX_HERO_SIZE },
  product: { folder: "products", maxSize: MAX_IMAGE_SIZE },
  inspection: { folder: "inspections", maxSize: MAX_IMAGE_SIZE },
} as const satisfies Record<ImageUploadKind, { folder: string | null; maxSize: number }>;

interface ImageFileLike {
  size: number;
  type: string;
}

export const getImageUploadIssue = (
  file: ImageFileLike,
  kind: ImageUploadKind,
): ImageUploadIssue | null => {
  if (!IMAGE_UPLOAD_MIME_TYPES.some((type) => type === file.type)) {
    return "invalidType";
  }

  if (file.size > IMAGE_UPLOAD_CONFIG[kind].maxSize) {
    return "tooLarge";
  }

  return null;
};

export const getImageKeyFromUrl = (url: string | null | undefined) => {
  if (!url) return null;

  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").filter(Boolean).at(-1);
    return filename ? decodeURIComponent(filename) : null;
  } catch {
    return null;
  }
};
