"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { Button, Input, TableCell, TableRow } from "@louez/ui";

export interface ImportReviewRowData {
  rowIndex: number;
  payload: Record<string, string>;
  action: "create" | "update" | "skip" | "error";
  reasons: string[];
  warnings: string[];
}

interface ImportReviewRowProps {
  row: ImportReviewRowData;
  columns: string[];
  isSaving: boolean;
  onSave: (rowIndex: number, payload: Record<string, string>) => void;
}

/** One previewed row; a refused one can be corrected in place instead of going back to the spreadsheet. */
export const ImportReviewRow = ({ row, columns, isSaving, onSave }: ImportReviewRowProps) => {
  const t = useTranslations("dashboard.settings.import.review");
  const tProducts = useTranslations("dashboard.settings.import.products");
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  // A code is looked up in the customer wording first, then in the catalogue's.
  const describe = (group: "reasons" | "warnings", code: string) => {
    if (t.has(`${group}.${code}`)) return t(`${group}.${code}`);
    return tProducts.has(`${group}.${code}`) ? tProducts(`${group}.${code}`) : code;
  };
  const notes = [
    ...row.reasons.map((reason) => describe("reasons", reason)),
    ...row.warnings.map((warning) => describe("warnings", warning)),
  ];

  return (
    <TableRow>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
        {t("row", { index: row.rowIndex + 2 })}
      </TableCell>
      {columns.map((column) => (
        <TableCell key={column} className="max-w-44 text-sm">
          {draft ? (
            <Input
              aria-label={column}
              value={draft[column] ?? ""}
              className="h-8 min-w-28"
              onChange={(event) => setDraft({ ...draft, [column]: event.target.value })}
            />
          ) : (
            <span className="block truncate">{row.payload[column]}</span>
          )}
        </TableCell>
      ))}
      <TableCell className="text-sm">
        {notes.length > 0 && (
          <span className={row.action === "error" ? "text-destructive" : "text-muted-foreground"}>
            {notes.join(" · ")}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {row.action === "error" &&
          (draft ? (
            <span className="inline-flex gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {t("cancelFix")}
              </Button>
              <Button
                type="button"
                size="sm"
                isPending={isSaving}
                onClick={() => {
                  onSave(row.rowIndex, draft);
                  setDraft(null);
                }}
              >
                {t("saveFix")}
              </Button>
            </span>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setDraft(row.payload)}>
              {t("fix")}
            </Button>
          ))}
      </TableCell>
    </TableRow>
  );
};
