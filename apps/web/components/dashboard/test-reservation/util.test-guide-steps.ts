import type { ReservationStatus } from "@louez/api/contracts/reservations";

/**
 * The steps of a test reservation's guide (test-reservation-guide.tsx), each
 * checked from the reservation's status and its inspections: confirm, the
 * departure (its inspection when the store asks for one, else the pickup),
 * then the return.
 */
export type TestGuideStepKey = "confirm" | "departureInspection" | "pickup" | "return";

export interface TestGuideStep {
  key: TestGuideStepKey;
  done: boolean;
}

export type TestGuideState =
  | { kind: "steps"; steps: TestGuideStep[]; current: TestGuideStepKey }
  | { kind: "done" }
  /** Cancelled, rejected or declined: nothing left to rehearse. */
  | { kind: "closed" };

const PICKED_UP: ReadonlySet<string> = new Set(["ongoing", "completed"]);
const CLOSED: ReadonlySet<string> = new Set(["cancelled", "rejected", "declined"]);

export function testGuideState(input: {
  status: ReservationStatus;
  inspectionsEnabled: boolean;
  hasDepartureInspection: boolean;
}): TestGuideState {
  const { status } = input;
  if (status === "completed") return { kind: "done" };
  if (CLOSED.has(status)) return { kind: "closed" };

  const pickedUp = PICKED_UP.has(status);
  const steps: TestGuideStep[] = [
    { key: "confirm", done: status !== "pending" && status !== "quote" },
    input.inspectionsEnabled
      ? { key: "departureInspection", done: input.hasDepartureInspection || pickedUp }
      : { key: "pickup", done: pickedUp },
    { key: "return", done: false },
  ];
  const current = steps.find((step) => !step.done)?.key ?? "return";
  return { kind: "steps", steps, current };
}
