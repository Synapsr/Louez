import "server-only";

import { PutObjectAclCommand, S3Client } from "@aws-sdk/client-s3";
import { createFiles } from "files-sdk";
import { contentType } from "files-sdk/content-type";
import { s3 } from "files-sdk/s3";
import { validation } from "files-sdk/validation";

import { env } from "@/env";
import { publicImageAssets } from "@/lib/storage/public-image-assets-plugin";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";

let imageFiles: ReturnType<typeof createImageFiles> | undefined;
let rawClient: S3Client | undefined;
let storageAdapter: ReturnType<typeof createS3Adapter> | undefined;

/**
 * Whether stored assets are served same-origin through the app (S3_PUBLIC_URL
 * is a path like "/files") rather than from a public bucket URL. This — not
 * the deployment mode — is what decides how storage behaves: a private
 * bundled bucket (MinIO) that the browser cannot reach directly needs proxy
 * uploads, no per-object ACLs, and the /files streaming route; a public
 * bucket (absolute S3_PUBLIC_URL) uses presigned direct uploads, ACLs, and
 * serves reads from the bucket. Works the same in standalone and platform.
 */
export const isProxiedStorage = (): boolean =>
  (env.S3_PUBLIC_URL ?? "").startsWith("/");

const createS3Adapter = () => {
  const adapter = s3({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    publicBaseUrl: env.S3_PUBLIC_URL,
  });

  rawClient = adapter.raw as S3Client;

  // A private, same-origin-served bucket (bundled MinIO) cannot be reached by
  // a browser through a presigned URL, so stop advertising signed-url support
  // — files-sdk then falls back to same-origin proxy uploads through the
  // /api/files routes, and public reads go through the app's /files route.
  if (isProxiedStorage()) {
    return { ...adapter, signedUrl: { supported: false as const } };
  }

  return adapter;
};

/**
 * Makes a stored image publicly readable. Same-origin bundled storage needs
 * nothing: the bucket stays private and /files streams assets with the
 * server's credentials, so per-object ACLs are neither supported nor needed.
 */
export const setPublicReadAcl = async (key: string): Promise<void> => {
  if (isProxiedStorage()) return;

  await getStorageClient().send(
    new PutObjectAclCommand({
      ACL: "public-read",
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );
};

const createImageFiles = () => {
  const adapter = createS3Adapter();
  storageAdapter = adapter;

  return createFiles({
    adapter,
    plugins: [
      publicImageAssets({ setPublicReadAcl }),
      contentType({ onMismatch: "reject", onUnknown: "reject" }),
      validation({
        minSize: 1,
        allowedTypes: [...IMAGE_UPLOAD_MIME_TYPES],
        key: /^[a-zA-Z0-9/_-]+\.(?:jpe?g|png|gif|webp)$/,
      }),
    ],
  });
};

export const getImageFiles = () => {
  imageFiles ??= createImageFiles();
  return imageFiles;
};

/**
 * The bucket adapter without the instance's plugins, for presigned uploads:
 * the content-type and validation plugins refuse to presign, as the bytes
 * never pass through them. Whoever presigns checks the object afterwards
 * (packages/api services/uploads.ts reads its first bytes).
 */
export const getImageStorageAdapter = () => {
  getImageFiles();
  return storageAdapter as ReturnType<typeof createS3Adapter>;
};

/** Raw S3 client shared with the /files streaming route. */
export const getStorageClient = (): S3Client => {
  getImageFiles();
  return rawClient as S3Client;
};
