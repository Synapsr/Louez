import { generateCsv } from "@/lib/export/csv";

interface ImportErrorRow {
  rowIndex: number;
  payload: Record<string, string>;
  errors: { field: string | null; code: string }[] | null;
}

/**
 * The refused rows as a CSV the merchant can fix and import again: their
 * original cells, plus the line they came from and why they were refused.
 */
export const buildImportErrorReport = (
  rows: readonly ImportErrorRow[],
  labels: { line: string; reason: string; translateReason: (code: string) => string },
): string => {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row.payload)))];
  return generateCsv(
    [labels.line, ...columns, labels.reason],
    rows.map((row) => [
      String(row.rowIndex + 2),
      ...columns.map((column) => row.payload[column] ?? ""),
      (row.errors ?? []).map((error) => labels.translateReason(error.code)).join(" · "),
    ]),
  );
};

export const downloadTextFile = (
  fileName: string,
  content: string,
  type = "text/csv;charset=utf-8",
) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};
