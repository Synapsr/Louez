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

// Origins derive from runtime env: computed lazily so importing this module
// never throws — the prebuilt Docker image is built without NEXT_PUBLIC
// values and `next build` evaluates route modules during page-data
// collection.
const getOriginConfig = () => {
  const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
  const origins = new Set([appUrl.origin]);

  if (env.NEXT_PUBLIC_APP_DOMAIN && env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN) {
    try {
      origins.add(
        new URL(
          `${appUrl.protocol}//${env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN}.${env.NEXT_PUBLIC_APP_DOMAIN}`,
        ).origin,
      );
    } catch {
      // A malformed dashboard host only costs the extra allowed origin.
    }
  }

  return { appOrigin: appUrl.origin, allowedOrigins: [...origins] };
};

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
  const { appOrigin, allowedOrigins } = getOriginConfig();

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
      router.handle(createPublicFilesRequest(request, allowedOrigins, appOrigin)),
  };
};

export const getImageFilesRouter = (kind: ImageUploadKind) => {
  const existing = routers.get(kind);
  if (existing) return existing;

  const router = createImageFilesRouter(kind);
  routers.set(kind, router);
  return router;
};
