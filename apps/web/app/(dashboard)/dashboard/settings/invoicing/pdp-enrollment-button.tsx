import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";

import { PDP_ENROLLMENT_START_HREF } from "./util.pdp-transmission";

type PdpEnrollmentButtonProps = {
  /** Prerequisites are missing: the route would bounce back with an error. */
  disabled?: boolean;
  labelKey: "connectAction" | "reconnectAction" | "resumeAction";
  variant?: "default" | "outline";
};

/**
 * Entry point of the Super PDP OAuth enrollment.
 * The target is a route handler, so it is reached with a plain anchor —
 * a client-side navigation would never hit its redirect.
 */
export const PdpEnrollmentButton = async ({
  disabled = false,
  labelKey,
  variant = "default",
}: PdpEnrollmentButtonProps) => {
  const t = await getTranslations("dashboard.settings.invoicing.transmission");
  const label = t(labelKey);

  if (disabled) {
    return (
      <Button className="w-fit" disabled type="button" variant={variant}>
        {label}
      </Button>
    );
  }

  return (
    <Button className="w-fit" render={<a href={PDP_ENROLLMENT_START_HREF} />} variant={variant}>
      {label}
    </Button>
  );
};
