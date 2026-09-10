import { env } from "@/env";

/** The gallery renders fixtures only, but it exposes internals: local development only. */
export const isDocumentPreviewEnabled = (): boolean => env.NODE_ENV === "development";
