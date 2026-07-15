import "server-only";

import { createFiles } from "files-sdk";
import { contentType } from "files-sdk/content-type";
import { s3 } from "files-sdk/s3";
import { validation } from "files-sdk/validation";

import { env } from "@/env";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";

let imageFiles: ReturnType<typeof createImageFiles> | undefined;

const createImageFiles = () =>
  createFiles({
    adapter: s3({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
      publicBaseUrl: env.S3_PUBLIC_URL,
    }),
    plugins: [
      contentType({ onMismatch: "reject", onUnknown: "reject" }),
      validation({
        minSize: 1,
        allowedTypes: [...IMAGE_UPLOAD_MIME_TYPES],
        key: /^[a-zA-Z0-9/_-]+\.(?:jpe?g|png|gif|webp)$/,
      }),
    ],
  });

export const getImageFiles = () => {
  imageFiles ??= createImageFiles();
  return imageFiles;
};
