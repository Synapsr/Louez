/** The same distance/fee badge, with or without a map underneath it. */
export const CheckoutDeliveryLegSummary = ({ summary }: { summary: string | null }) =>
  summary ? (
    <span className="rounded-full bg-background/95 px-2.5 py-1 text-xs font-medium tabular-nums shadow-raised backdrop-blur">
      {summary}
    </span>
  ) : null;
