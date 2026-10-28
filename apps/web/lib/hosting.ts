import { z } from "zod";

/**
 * Who hosts this instance, `LOUEZ_HOSTED_BY`. It decides the storefront legal notice's
 * hosting line and whether the dashboard asks for a GitHub star. Neither billing
 * (LOUEZ_BILLING) nor routing (LOUEZ_MODE) decides it.
 * - unset (the default): the operator hosts the instance. The notice names no host,
 *   since only the operator knows who it is, and the dashboard may ask for a star.
 * - `lumycloud`: Louez Cloud. The notice names LumyCloud and the dashboard never asks.
 */
export const louezHostedBySchema = z.enum(["lumycloud"]).optional();

export type LouezHost = NonNullable<z.infer<typeof louezHostedBySchema>>;

/**
 * Read from process.env at call time, like LOUEZ_MODE, so the prebuilt Docker image
 * honors the runtime value. Anything but a known host means the operator hosts it: the
 * env schema rejects other values, but SKIP_ENV_VALIDATION hands the raw string through.
 */
export function getHostedBy(): LouezHost | null {
  const parsed = louezHostedBySchema.safeParse(process.env.LOUEZ_HOSTED_BY || undefined);
  return parsed.success ? (parsed.data ?? null) : null;
}

/** Whether the operator hosts this instance itself. */
export function isSelfHosted(): boolean {
  return getHostedBy() === null;
}

/**
 * What is wrong with the hosting identity at start-up, or null.
 * - With LOUEZ_BILLING=cloud and no known host, the instance is most likely Louez Cloud
 *   deployed without LOUEZ_HOSTED_BY: every storefront legal notice would lose its
 *   hosting section, which French law requires (LCEN art. 6), and every dashboard would
 *   ask owners for a GitHub star. `stop` is true: the server refuses to start.
 * - On any other instance an unknown value only gets a log: it counts as self-hosted.
 */
export function describeHostingMisconfiguration(input: {
  louezBilling: string | undefined;
  louezHostedBy: string | undefined;
}): { message: string; stop: boolean } | null {
  const hostedBy = input.louezHostedBy;
  const known = hostedBy !== undefined && louezHostedBySchema.safeParse(hostedBy).success;
  if (input.louezBilling === "cloud" && !known) {
    const problem =
      hostedBy === undefined
        ? "LOUEZ_HOSTED_BY is not set"
        : `LOUEZ_HOSTED_BY="${hostedBy}" is not a known host`;
    return {
      message:
        `LOUEZ_BILLING=cloud is set but ${problem}: storefront legal notices would name no ` +
        "host and the dashboard would ask for a GitHub star. Set LOUEZ_HOSTED_BY=lumycloud on " +
        "Louez Cloud. Stopping.",
      stop: true,
    };
  }
  if (hostedBy === undefined || known) return null;
  return {
    message:
      `LOUEZ_HOSTED_BY="${hostedBy}" is not a known host, so the instance counts as ` +
      "self-hosted. Set LOUEZ_HOSTED_BY=lumycloud on Louez Cloud, or leave it unset.",
    stop: false,
  };
}
