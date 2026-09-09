import { z } from "zod";

export const dateChangeRequestSchema = z.object({
  kind: z.literal("return_date_request"),
  status: z.enum(["pending", "accepted", "rejected", "cancelled", "superseded"]),
  originalStartDate: z.string().datetime(),
  originalEndDate: z.string().datetime(),
  requestedEndDate: z.string().datetime(),
  reason: z.string().max(1000),
});

export type DateChangeRequest = z.infer<typeof dateChangeRequestSchema> & { id: string };

export const getDateChangeRequests = (
  rows: { id: string; metadata: unknown }[],
): DateChangeRequest[] =>
  rows.flatMap((row) => {
    const parsed = dateChangeRequestSchema.safeParse(row.metadata);
    return parsed.success ? [{ id: row.id, ...parsed.data }] : [];
  });

export const canRequestDateChange = (status: string): boolean =>
  status === "confirmed" || status === "ongoing";

export const isValidRequestedEndDate = (
  requestedEnd: Date,
  start: Date,
  end: Date,
  now: Date,
): boolean =>
  Number.isFinite(requestedEnd.getTime()) &&
  requestedEnd > start &&
  requestedEnd > now &&
  requestedEnd > end;

export const getDateChangeResolution = (
  request: DateChangeRequest,
  startDate: Date,
  endDate: Date,
): "pending" | "accepted" | "superseded" => {
  if (
    request.originalStartDate === startDate.toISOString() &&
    request.requestedEndDate === endDate.toISOString()
  )
    return "accepted";
  if (
    request.originalStartDate === startDate.toISOString() &&
    request.originalEndDate === endDate.toISOString()
  )
    return "pending";
  return "superseded";
};
