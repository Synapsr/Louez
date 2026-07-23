export const openReplayEvents = {
  dashboardReservationCreationStarted: "dashboard_reservation_creation_started",
  dashboardReservationCreationCompleted: "dashboard_reservation_creation_completed",
  dashboardCustomerCreationStarted: "dashboard_customer_creation_started",
  dashboardCustomerCreationCompleted: "dashboard_customer_creation_completed",
} as const;

export const dashboardCreationSources = [
  "direct",
  "dashboard_header",
  "quick_action",
  "onboarding",
  "reservations_page",
  "customers_page",
  "command_palette",
] as const;

export type DashboardCreationSource = (typeof dashboardCreationSources)[number];

type OpenReplayEventPayloads = {
  [openReplayEvents.dashboardReservationCreationStarted]: {
    journey: "reservation_creation";
    step: "started";
    source: DashboardCreationSource;
  };
  [openReplayEvents.dashboardReservationCreationCompleted]: {
    journey: "reservation_creation";
    step: "completed";
    source: DashboardCreationSource;
  };
  [openReplayEvents.dashboardCustomerCreationStarted]: {
    journey: "customer_creation";
    step: "started";
    source: DashboardCreationSource;
  };
  [openReplayEvents.dashboardCustomerCreationCompleted]: {
    journey: "customer_creation";
    step: "completed";
    source: DashboardCreationSource;
  };
};

export type OpenReplayEventName = keyof OpenReplayEventPayloads;

export type OpenReplayEventPayload<Name extends OpenReplayEventName> =
  OpenReplayEventPayloads[Name];

const isDashboardCreationSource = (value: string): value is DashboardCreationSource =>
  dashboardCreationSources.some((source) => source === value);

export const resolveDashboardCreationSource = (
  value: string | string[] | undefined,
): DashboardCreationSource => {
  const candidate = Array.isArray(value) ? value[0] : value;

  return candidate && isDashboardCreationSource(candidate) ? candidate : "direct";
};
