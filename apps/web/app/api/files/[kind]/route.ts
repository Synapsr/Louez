import { NextResponse } from "next/server";

import { z } from "zod";

import { getImageFilesRouter } from "@/lib/uploads/image-files-router";
import { IMAGE_UPLOAD_KINDS } from "@/lib/uploads/image-upload";
import { getHeroVideoFilesRouter } from "@/lib/uploads/hero-video-files-router";

interface RouteContext {
  params: Promise<{ kind: string }>;
}

const kindSchema = z.enum(IMAGE_UPLOAD_KINDS);

const handleRequest = async (request: Request, context: RouteContext) => {
  const { kind } = await context.params;
  if (kind === "hero-video") return getHeroVideoFilesRouter().handle(request);
  const parsedKind = kindSchema.safeParse(kind);
  if (!parsedKind.success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return getImageFilesRouter(parsedKind.data).handle(request);
};

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
