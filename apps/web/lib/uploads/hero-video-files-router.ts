import "server-only";

import { FilesError } from "files-sdk";
import { createFilesRouter, type FilesApi } from "files-sdk/api";

import { env as authEnv } from "@louez/auth/env";
import { MAX_HERO_VIDEO_SIZE } from "@louez/validations";

import { env } from "@/env";
import { getHeroVideoFiles } from "@/lib/storage/files";
import { getCurrentStore } from "@/lib/store-context";

import { createPublicFilesRequest } from "./util.public-files-request";

let router: FilesApi | undefined;

export const getHeroVideoFilesRouter = () => {
  if (router) return router;
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
  const allowedOrigins = [...origins];
  const filesRouter = createFilesRouter({
    files: () => getHeroVideoFiles(),
    operations: ["upload", "url", "delete"],
    allowedOrigins,
    maxUploadSize: MAX_HERO_VIDEO_SIZE,
    secret: `louez-hero-video-upload:${authEnv.AUTH_SECRET}`,
    authorize: async () => {
      const store = await getCurrentStore();
      if (!store) throw new FilesError("Unauthorized", "Store access required");
      return { keyPrefix: `${store.id}/logo/hero-video/`, disposition: "inline" };
    },
  });
  router = {
    handle: (request) =>
      filesRouter.handle(createPublicFilesRequest(request, allowedOrigins, appUrl.origin)),
  };
  return router;
};
