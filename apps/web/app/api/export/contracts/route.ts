import { NextResponse } from "next/server";

import { contractExportParamsSchema } from "@/lib/export/types";
import { resolveStoreExportDateRange } from "@/lib/export/date-range";
import {
  createContractArchiveStream,
  queryContractExportReservations,
} from "@/lib/export/contracts";
import { useLogger, withEvlog } from "@/lib/evlog";
import { currentUserHasPermission, getCurrentStore } from "@/lib/store-context";

const sanitizeFilename = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");

const handleGet = async (request: Request) => {
  const logger = useLogger();

  try {
    const store = await getCurrentStore();
    if (!store) {
      return NextResponse.json({ error: "errors.unauthorized" }, { status: 401 });
    }

    const hasPermission = await currentUserHasPermission("manage_settings");
    if (!hasPermission) {
      return NextResponse.json({ error: "errors.forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const parsed = contractExportParamsSchema.safeParse({
      startDate: url.searchParams.get("startDate"),
      endDate: url.searchParams.get("endDate"),
      statuses: url.searchParams.getAll("status"),
      locale: url.searchParams.get("locale") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "errors.invalidData" }, { status: 400 });
    }

    const params = parsed.data;
    const range = resolveStoreExportDateRange(
      params.startDate,
      params.endDate,
      store.settings?.timezone,
    );
    const exportReservations = await queryContractExportReservations(store.id, params, range);

    if (exportReservations.length === 0) {
      return NextResponse.json({ error: "errors.noContracts" }, { status: 404 });
    }

    logger.set({
      contractExport: {
        storeId: store.id,
        startDate: params.startDate,
        endDate: params.endDate,
        statuses: params.statuses,
        reservationCount: exportReservations.length,
      },
    });

    const stream = createContractArchiveStream({
      reservations: exportReservations,
      locale: params.locale,
      onContractError: (error, reservation) => {
        logger.error(error, {
          step: "contract-export-item",
          reservationId: reservation.id,
          reservationNumber: reservation.number,
        });
      },
      onFatalError: (error) => {
        logger.error(error, { step: "contract-export-archive" });
      },
    });
    const filename = `${sanitizeFilename(store.slug)}-contracts-${params.startDate}-to-${params.endDate}.zip`;

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error("Contract export failed"));
    return NextResponse.json({ error: "errors.serverError" }, { status: 500 });
  }
};

export const GET = withEvlog(handleGet);
