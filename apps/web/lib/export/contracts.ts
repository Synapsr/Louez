import { and, asc, between, eq, inArray } from "drizzle-orm";
import { strToU8, Zip, ZipPassThrough } from "fflate";

import { db, reservations } from "@louez/db";

import { generateContract, getContractPdfBuffer } from "@/lib/pdf/generate";
import type { ContractExportParams } from "./types";

export interface ContractExportReservation {
  id: string;
  number: string;
}

interface ContractArchiveOptions {
  reservations: ContractExportReservation[];
  locale: ContractExportParams["locale"];
  onContractError?: (error: Error, reservation: ContractExportReservation) => void;
  onFatalError?: (error: Error) => void;
}

export async function queryContractExportReservations(
  storeId: string,
  params: ContractExportParams,
  range: { startDate: Date; endDate: Date },
): Promise<ContractExportReservation[]> {
  return db
    .select({
      id: reservations.id,
      number: reservations.number,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        between(reservations.startDate, range.startDate, range.endDate),
        inArray(reservations.status, params.statuses),
      ),
    )
    .orderBy(asc(reservations.startDate), asc(reservations.number));
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function sanitizeArchiveFileName(fileName: string, reservationId: string): string {
  const baseName = fileName.replace(/\.pdf$/i, "");
  const sanitized = baseName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${sanitized || `contract-${reservationId}`}.pdf`;
}

function createFailureReport(
  failures: ContractExportReservation[],
  locale: ContractExportParams["locale"],
): Uint8Array {
  const title =
    locale === "en"
      ? "Some contracts could not be exported:"
      : "Certains contrats n'ont pas pu être exportés :";
  const retry =
    locale === "en"
      ? "Try downloading these contracts individually from their reservation page."
      : "Essayez de télécharger ces contrats individuellement depuis leur réservation.";
  const lines = failures.map((reservation) => `- #${reservation.number}`);

  return strToU8([title, "", ...lines, "", retry].join("\n"));
}

export function createContractArchiveStream({
  reservations: exportReservations,
  locale,
  onContractError,
  onFatalError,
}: ContractArchiveOptions): ReadableStream<Uint8Array> {
  let archive: Zip | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false;

      const failArchive = (error: unknown) => {
        if (settled || cancelled) return;
        settled = true;
        const resolvedError = toError(error, "Contract archive generation failed");
        onFatalError?.(resolvedError);
        archive?.terminate();
        controller.error(resolvedError);
      };

      archive = new Zip((error, chunk, final) => {
        if (error) {
          failArchive(error);
          return;
        }

        if (settled || cancelled) return;
        controller.enqueue(chunk);

        if (final) {
          settled = true;
          controller.close();
        }
      });

      void (async () => {
        const failures: ContractExportReservation[] = [];
        const fileNames = new Set<string>();

        for (const reservation of exportReservations) {
          if (cancelled) return;

          try {
            let pdfBuffer = await getContractPdfBuffer(reservation.id);

            if (!pdfBuffer) {
              await generateContract({
                reservationId: reservation.id,
                locale,
              });
              pdfBuffer = await getContractPdfBuffer(reservation.id);
            }

            if (!pdfBuffer) {
              throw new Error("Contract PDF is unavailable after generation");
            }

            const localizedFileName =
              locale === "en"
                ? `contract-${reservation.number}.pdf`
                : `contrat-${reservation.number}.pdf`;
            let fileName = sanitizeArchiveFileName(localizedFileName, reservation.id);
            if (fileNames.has(fileName)) {
              fileName = fileName.replace(/\.pdf$/i, `-${reservation.id.slice(-6)}.pdf`);
            }
            fileNames.add(fileName);

            const entry = new ZipPassThrough(fileName);
            archive?.add(entry);
            entry.push(new Uint8Array(pdfBuffer), true);
          } catch (error) {
            const resolvedError = toError(error, "Contract generation failed");
            failures.push(reservation);
            onContractError?.(resolvedError, reservation);
          }
        }

        if (failures.length > 0) {
          const report = new ZipPassThrough(
            locale === "en" ? "export-report.txt" : "rapport-export.txt",
          );
          archive?.add(report);
          report.push(createFailureReport(failures, locale), true);
        }

        archive?.end();
      })().catch(failArchive);
    },
    cancel() {
      cancelled = true;
      archive?.terminate();
    },
  });
}
