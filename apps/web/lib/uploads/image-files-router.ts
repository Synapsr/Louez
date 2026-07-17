import "server-only";

import { FilesError } from "files-sdk";
import { createFilesRouter, type FilesApi } from "files-sdk/api";

import { env as authEnv } from "@louez/auth/env";

import { env } from "@/env";
import { auth } from "@/lib/auth";
import { getImageFiles } from "@/lib/storage/files";
import { getCurrentStore } from "@/lib/store-context";

import { IMAGE_UPLOAD_CONFIG, type ImageUploadKind } from "./image-upload";
import { createPublicFilesRequest } from "./util.public-files-request";

const routers = new Map<ImageUploadKind, FilesApi>();
const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
const dashboardOrigin = new URL(
  `${appUrl.protocol}//${env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN}.${env.NEXT_PUBLIC_APP_DOMAIN}`,
).origin;
const allowedOrigins = [...new Set([appUrl.origin, dashboardOrigin])];

const getKeyPrefix = async (kind: ImageUploadKind) => {
  if (kind === "avatar") {
    const session = await auth();
    if (!session?.user.id) {
      throw new FilesError("Unauthorized", "Sign in required");
    }
    return `users/${session.user.id}/`;
  }

  const store = await getCurrentStore();
  if (!store) {
    throw new FilesError("Unauthorized", "Store access required");
  }

  const folder = IMAGE_UPLOAD_CONFIG[kind].folder;
  return `${store.id}/${folder}/`;
};

const createImageFilesRouter = (kind: ImageUploadKind) => {
  const router = createFilesRouter({
    files: () => getImageFiles(),
    operations: ["upload", "url", "delete"],
    allowedOrigins,
    maxUploadSize: IMAGE_UPLOAD_CONFIG[kind].maxSize,
    secret: `louez-image-upload:${authEnv.AUTH_SECRET}`,
    authorize: async () => ({
      keyPrefix: await getKeyPrefix(kind),
      disposition: "inline",
    }),
  });

  return {
    handle: (request: Request) =>
      router.handle(createPublicFilesRequest(request, allowedOrigins, appUrl.origin)),
  };
};

export const getImageFilesRouter = (kind: ImageUploadKind) => {
  const existing = routers.get(kind);
  if (existing) return existing;

  const router = createImageFilesRouter(kind);
  routers.set(kind, router);
  return router;
};
