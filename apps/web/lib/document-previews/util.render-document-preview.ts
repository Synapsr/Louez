import { render } from "@react-email/render";
import { renderToBuffer } from "@react-pdf/renderer";

import type { DocumentPreview, DocumentPreviewContext } from "./document-previews.types";

export type RenderedDocumentPreview =
  | { kind: "email"; contentType: "text/html; charset=utf-8"; body: string }
  | {
      kind: "pdf";
      contentType: "application/pdf";
      body: Uint8Array<ArrayBuffer>;
      fileName: string;
    };

export const renderDocumentPreview = async (
  document: DocumentPreview,
  context: DocumentPreviewContext,
): Promise<RenderedDocumentPreview> => {
  if (document.kind === "email") {
    const { element } = document.compose(context);
    return { kind: "email", contentType: "text/html; charset=utf-8", body: await render(element) };
  }

  const buffer = await renderToBuffer(document.compose(context));
  // Copy into a plain ArrayBuffer-backed view: that is what a Response body accepts.
  const body = new Uint8Array(new ArrayBuffer(buffer.byteLength));
  body.set(buffer);
  return {
    kind: "pdf",
    contentType: "application/pdf",
    body,
    fileName: `${document.fileName}-${context.locale}.pdf`,
  };
};
