import type { StoragePort } from "./ports";

/** A stored object of the in-memory storage. */
export interface MemoryObject {
  bytes: Uint8Array;
  contentType: string;
  public: boolean;
  /** When it was written: `put` records it; an object a test sets without one counts as written now. */
  lastModified?: Date;
}

export interface MemoryStorage extends StoragePort {
  objects: Map<string, MemoryObject>;
  /** A stored object's bytes, type and visibility, without its date: what tests compare. */
  content: (key: string) => Omit<MemoryObject, "lastModified"> | undefined;
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
    content: (key) => {
      const object = objects.get(key);
      return (
        object && { bytes: object.bytes, contentType: object.contentType, public: object.public }
      );
    },
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
      objects.set(key, { bytes: body, contentType, public: false, lastModified: new Date() });
    },
    head: async (key) => {
      const object = objects.get(key);
      return object ? { size: object.bytes.byteLength, contentType: object.contentType } : null;
    },
    read: async (key, maxBytes) => objects.get(key)?.bytes.slice(0, maxBytes) ?? null,
    publish: async (key) => {
      const object = objects.get(key);
      if (object) object.public = true;
      return `${publicBaseUrl}/${key}`;
    },
    list: async (prefix) => ({
      items: [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({ key, lastModified: object.lastModified ?? new Date() })),
      cursor: null,
    }),
    delete: async (key) => {
      objects.delete(key);
    },
  };
}
