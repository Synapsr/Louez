import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDocumentPreview,
  getDocumentPreviewStore,
} from "@/lib/document-previews/document-previews.catalog";
import {
  DEFAULT_DOCUMENT_PREVIEW_STORE_ID,
  EMAIL_PREVIEW_LOCALES,
} from "@/lib/document-previews/document-previews.fixtures";
import { isDocumentPreviewEnabled } from "@/lib/document-previews/util.document-preview-access";
import { renderDocumentPreview } from "@/lib/document-previews/util.render-document-preview";

const querySchema = z.object({
  store: z.string().default(DEFAULT_DOCUMENT_PREVIEW_STORE_ID),
  locale: z.enum(EMAIL_PREVIEW_LOCALES).default("fr"),
});

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

/** Renders one catalog document with fixture data, as HTML (emails) or PDF. Dev only. */
export async function GET(request: Request, { params }: RouteContext) {
  if (!isDocumentPreviewEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const { documentId } = await params;
  const document = getDocumentPreview(documentId);
  if (!document) {
    return NextResponse.json({ error: "Unknown document" }, { status: 404 });
  }

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const store = getDocumentPreviewStore(query.data.store);
  if (!store) {
    return NextResponse.json({ error: "Unknown fixture store" }, { status: 400 });
  }
  if (!document.locales.includes(query.data.locale)) {
    return NextResponse.json({ error: "Locale not supported by this document" }, { status: 400 });
  }

  const rendered = await renderDocumentPreview(document, { store, locale: query.data.locale });

  return new NextResponse(rendered.body, {
    headers: {
      "Content-Type": rendered.contentType,
      "Cache-Control": "no-store",
      ...(rendered.kind === "pdf"
        ? { "Content-Disposition": `inline; filename="${rendered.fileName}"` }
        : {}),
    },
  });
}
