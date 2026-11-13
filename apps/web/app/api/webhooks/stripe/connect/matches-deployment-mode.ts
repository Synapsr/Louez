import { stripeKeyMode } from "@/lib/stripe/client";

/**
 * Whether a Stripe event belongs to this deployment: its `livemode` is the mode of
 * the deployment's secret key, as `stripeKeyMode` reads it (a `sk_test_` or `rk_test_`
 * key is test, any other key is live). A deployment with no key hears no event.
 */
export const matchesDeploymentMode = ({
  livemode,
  secretKey,
}: {
  readonly livemode: boolean;
  readonly secretKey: string | undefined;
}): boolean => !!secretKey && (stripeKeyMode(secretKey) === "live") === livemode;
