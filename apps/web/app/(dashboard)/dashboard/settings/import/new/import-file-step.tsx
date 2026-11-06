"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import {
  Alert,
  AlertDescription,
  Button,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@louez/ui";
import { parseDelimitedText } from "@louez/utils";
import { IMPORT_LIMITS } from "@louez/validations";

import { FileDropzone } from "@/components/ui/file-dropzone";
import { readDelimitedFile } from "@/lib/import/util.import-file";

import type { ImportOrigin, ImportSourceData } from "./import-wizard.types";

interface ImportFileStepProps {
  origin: ImportOrigin;
  data: ImportSourceData | null;
  onData: (data: ImportSourceData | null) => void;
}

const PREVIEW_ROWS = 5;

export const ImportFileStep = ({ origin, data, onData }: ImportFileStepProps) => {
  const t = useTranslations("dashboard.settings.import.file");
  const [isReading, setIsReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const load = (text: string, fileName: string | null) => {
    const table = parseDelimitedText(text);
    if (table.headers.length === 0 || table.rows.length === 0) {
      setProblem(t("noRows"));
      onData(null);
      return;
    }
    if (table.rows.length > IMPORT_LIMITS.rows) {
      setProblem(t("tooManyRows", { rows: table.rows.length }));
      onData(null);
      return;
    }
    setProblem(null);
    onData({ origin, fileName, table });
  };

  const handleFile = async (file: File) => {
    setIsReading(true);
    try {
      load(await readDelimitedFile(file), file.name);
    } catch {
      setProblem(t("unreadable"));
      onData(null);
    } finally {
      setIsReading(false);
    }
  };

  return (
    <div className="space-y-4">
      {origin === "file" ? (
        <FileDropzone
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          title={data?.fileName ?? t("drop")}
          hint={data ? t("replace") : `${t("browse")} · ${t("formats")}`}
          busyLabel={t("reading")}
          isBusy={isReading}
          onFile={handleFile}
        />
      ) : (
        <div className="space-y-2">
          <Label htmlFor="import-paste">{t("pasteLabel")}</Label>
          <Textarea
            id="import-paste"
            rows={8}
            value={pasted}
            placeholder={t("pastePlaceholder")}
            className="font-mono text-xs"
            onChange={(event) => {
              setPasted(event.target.value);
              if (event.target.value.trim()) load(event.target.value, null);
              else onData(null);
            }}
          />
        </div>
      )}

      {problem && (
        <Alert variant="error">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}

      {data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("previewTitle")}</p>
            <p className="text-muted-foreground text-sm">
              {t("detected", { rows: data.table.rows.length, columns: data.table.headers.length })}
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {data.table.headers.map((header) => (
                    <TableHead key={header} className="whitespace-nowrap">
                      {header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.table.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                  // Preview rows have no identity of their own: their position is the key.
                  <TableRow key={index}>
                    {data.table.headers.map((header) => (
                      <TableCell key={header} className="max-w-48 truncate text-sm">
                        {row[header]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {origin === "paste" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPasted("");
                onData(null);
              }}
            >
              {t("replace")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
