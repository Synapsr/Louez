import "server-only";

import type { StoragePort } from "@louez/api";
import { UPLOAD_PATH_PREFIX } from "@louez/api/platform/uploads";
import { FilesError } from "files-sdk";

import { env } from "@/env";
import {
  getImageFiles,
  getImageStorageAdapter,
  isProxiedStorage,
  setPublicReadAcl,
} from "@/lib/storage/files";

const isNotFound = (error: unknown) => error instanceof FilesError && error.code === "NotFound";

/**
 * The image storage the API's upload procedures use (packages/api
 * platform/ports.ts): the same bucket and files instance as the dashboard's
 * file routes. A public bucket takes presigned uploads; a private one, served
 * through /files, takes them through the app at /api/v1/uploads/<token>.
 */
export const apiStorage: StoragePort = {
  signUpload: async (key, { contentType, maxSize, expiresIn }) => {
    if (isProxiedStorage()) return null;
    const signed = await getImageStorageAdapter().signedUploadUrl(key, {
      contentType,
      maxSize,
      minSize: 1,
      expiresIn,
    });
    return signed.method === "PUT"
      ? {
          method: "PUT",
          url: signed.url,
          headers: signed.headers ?? { "content-type": contentType },
        }
      : signed;
  },
  uploadUrl: (token) => new URL(`${UPLOAD_PATH_PREFIX}${token}`, env.NEXT_PUBLIC_APP_URL).href,
  put: async (key, body, contentType) => {
    await getImageFiles().upload(key, body, { contentType });
  },
  head: async (key) => {
    try {
      const file = await getImageFiles().head(key);
      return { size: file.size, contentType: file.type };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },
  readStart: async (key, length) => {
    const file = await getImageFiles().download(key, { range: { start: 0, end: length - 1 } });
    return new Uint8Array(await file.arrayBuffer());
  },
  publish: async (key) => {
    await setPublicReadAcl(key);
    return getImageFiles().url(key);
  },
  delete: async (key) => {
    await getImageFiles().delete(key);
  },
};
