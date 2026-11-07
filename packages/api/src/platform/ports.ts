/**
 * What the agent-ready API takes from the app that serves it: only what is
 * bound to Next.js or to the billing service, and, for now, the image
 * storage (see `StoragePort`). Business code (Stripe, e-mail…) lives in the
 * package as services and adapters, never here.
 *
 * Every handler of the app (RPC, OpenAPI, MCP, uploads) builds the same object
 * and puts it in the context as `ports`.
 */
export interface ApiPorts {
  /** Features of the plan in force for the store (billing owns plans). */
  planFeatures: (storeId: string) => Promise<{ apiAccess: boolean }>;
  storage: StoragePort;
}

/** How a caller sends the bytes of an upload: one HTTP request, as given. */
export type UploadTarget =
  | { method: "PUT"; url: string; headers: Record<string, string> }
  | { method: "POST"; url: string; fields: Record<string, string> };

/**
 * The app's image storage, lent to the upload procedures
 * (services/uploads.ts). The storage client is configured from the app's
 * environment and shared with the dashboard's file routes and the `/files`
 * route; it moves into the package as an adapter when products need it too.
 * Keys are full storage keys (`<storeId>/categories/<id>.png`); the upload
 * service mints and checks them, the port never decides who owns what.
 */
export interface StoragePort {
  /**
   * A presigned upload straight to the bucket, bound to `contentType` and at
   * most `maxSize` bytes; null when the bucket is private and served through
   * the app, so uploads must go through the app (`uploadUrl`).
   */
  signUpload: (
    key: string,
    options: { contentType: string; maxSize: number; expiresIn: number },
  ) => Promise<UploadTarget | null>;
  /** Absolute URL of the app's upload endpoint for an upload token. */
  uploadUrl: (token: string) => string;
  /** Stores bytes received by the app's upload endpoint. */
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  /** Size and type of a stored object, or null when there is none. */
  head: (key: string) => Promise<{ size: number; contentType: string } | null>;
  /** The first `length` bytes of a stored object. */
  readStart: (key: string, length: number) => Promise<Uint8Array>;
  /** Makes a stored object publicly readable; returns its public URL. */
  publish: (key: string) => Promise<string>;
  delete: (key: string) => Promise<void>;
}
