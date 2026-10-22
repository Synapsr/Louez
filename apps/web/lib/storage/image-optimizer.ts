import type { ImageProps } from "next/image";
import type { NextConfig } from "next";

type RemotePattern = Extract<
  NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number],
  { hostname: string }
>;

/**
 * Absolute base URL of stored images, or null when they are served
 * same-origin (S3_PUBLIC_URL="/files") or the value is not an http(s) URL.
 */
export const parseStorageImageBase = (publicUrl: string | undefined): URL | null => {
  if (!publicUrl || publicUrl.startsWith("/")) return null;

  try {
    const base = new URL(publicUrl);
    return base.protocol === "https:" || base.protocol === "http:" ? base : null;
  } catch {
    return null;
  }
};

const basePathPrefix = (base: URL) => `${base.pathname.replace(/\/+$/, "")}/`;

/**
 * The only remote source /_next/image may fetch: this instance's bucket.
 * Wildcards over shared storage hosts would let anyone have the server fetch
 * a file from their own bucket.
 */
export const storageImageRemotePattern = (publicUrl: string | undefined): RemotePattern | null => {
  const base = parseStorageImageBase(publicUrl);
  if (!base) return null;

  return {
    protocol: base.protocol === "https:" ? "https" : "http",
    hostname: base.hostname,
    port: base.port,
    pathname: `${basePathPrefix(base)}**`,
  };
};

/**
 * Whether next/image may send this source through the optimizer.
 *
 * remotePatterns is fixed when the app is built, but the published Docker
 * image reads S3_PUBLIC_URL at runtime. Sources outside the bucket known at
 * build time (LOUEZ_OPTIMIZED_STORAGE_URL, inlined by next.config) load
 * directly in the browser instead of failing.
 */
export const canOptimizeImage = (src: ImageProps["src"] | null | undefined): boolean => {
  if (!src) return false;
  // Static imports and same-origin paths ("/files/...") stay optimized.
  if (typeof src !== "string") return true;
  if (src.startsWith("/")) return !src.startsWith("//");

  const base = parseStorageImageBase(process.env.LOUEZ_OPTIMIZED_STORAGE_URL);
  if (!base) return false;

  try {
    const url = new URL(src);
    return url.origin === base.origin && url.pathname.startsWith(basePathPrefix(base));
  } catch {
    return false;
  }
};
