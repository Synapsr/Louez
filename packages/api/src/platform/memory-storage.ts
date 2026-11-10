import type { StoragePort } from "./ports";

/** A stored object of the in-memory storage. */
export interface MemoryObject {
  bytes: Uint8Array;
  contentType: string;
  public: boolean;
}

export interface MemoryStorage extends StoragePort {
  objects: Map<string, MemoryObject>;
}

/**
 * The storage port in memory, for tests. `direct` makes it hand out
 * presigned uploads (a public bucket) instead of the app's upload endpoint
 * (a private, proxied bucket). Public URLs start with `publicBaseUrl`, which
 * tests also set as `S3_PUBLIC_URL` so the ownership checks recognize them.
 */
export function createMemoryStorage(
  options: { direct?: boolean; publicBaseUrl?: string; appUrl?: string } = {},
): MemoryStorage {
  const publicBaseUrl = options.publicBaseUrl ?? "https://files.louez.test";
  const appUrl = options.appUrl ?? "https://app.louez.test";
  const objects = new Map<string, MemoryObject>();

  return {
    objects,
    signUpload: async (key, { contentType }) =>
      options.direct
        ? {
            method: "PUT",
            url: `https://bucket.louez.test/${key}?signature=test`,
            headers: { "content-type": contentType },
          }
        : null,
    uploadUrl: (token) => `${appUrl}/api/v1/uploads/${token}`,
    put: async (key, body, contentType) => {
      objects.set(key, { bytes: body, contentType, public: false });
    },
    head: async (key) => {
      const object = objects.get(key);
      return object ? { size: object.bytes.byteLength, contentType: object.contentType } : null;
    },
    readStart: async (key, length) =>
      objects.get(key)?.bytes.subarray(0, length) ?? new Uint8Array(),
    publish: async (key) => {
      const object = objects.get(key);
      if (object) object.public = true;
      return `${publicBaseUrl}/${key}`;
    },
    delete: async (key) => {
      objects.delete(key);
    },
  };
}
