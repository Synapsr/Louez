import {
  IMAGE_UPLOAD_CONFIG,
  IMAGE_UPLOAD_KINDS,
  IMAGE_UPLOAD_MIME_TYPES,
  type ImageUploadKind,
} from "@louez/validations";

// Shared with the API's upload procedures (packages/api services/uploads.ts).
export { IMAGE_UPLOAD_CONFIG, IMAGE_UPLOAD_KINDS, IMAGE_UPLOAD_MIME_TYPES, type ImageUploadKind };

export type ImageUploadIssue = "invalidType" | "tooLarge";

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
