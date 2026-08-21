const PDF_DATA_URL_PREFIX = "data:application/pdf;base64,";

export function safePdfFileName(fileName: string): string {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized.endsWith(".pdf") ? sanitized : `${sanitized || "invoice"}.pdf`;
}

export function buildPdfResponse(fileUrl: string, fileName: string): Response {
  if (!fileUrl.startsWith(PDF_DATA_URL_PREFIX)) {
    return new Response("Invoice PDF not available", { status: 404 });
  }

  const pdf = Buffer.from(fileUrl.slice(PDF_DATA_URL_PREFIX.length), "base64");
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return new Response("Invalid invoice PDF", { status: 500 });
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safePdfFileName(fileName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
