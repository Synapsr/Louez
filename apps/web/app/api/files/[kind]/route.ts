import { NextResponse } from "next/server";

import { z } from "zod";

import { getImageFilesRouter } from "@/lib/uploads/image-files-router";
import { IMAGE_UPLOAD_KINDS } from "@/lib/uploads/image-upload";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ kind: string }>;
}

const kindSchema = z.enum(IMAGE_UPLOAD_KINDS);

const handleRequest = async (request: Request, context: RouteContext) => {
  const { kind } = await context.params;
  const parsedKind = kindSchema.safeParse(kind);
  if (!parsedKind.success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return getImageFilesRouter(parsedKind.data).handle(request);
};

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
