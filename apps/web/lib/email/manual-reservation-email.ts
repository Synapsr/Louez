import "server-only";

import type { EmailSettings } from "@louez/types";
import { getLogoForLightBackground } from "@louez/utils";

import { resolveEmailLogo } from "@/lib/email/logo";
import {
  buildManualReservationEmailFromContext,
  type BuildManualEmailFromContextOptions,
  type ManualEmailRenderContext,
  type ManualReservationEmailPayload,
} from "@/lib/email/manual-reservation-email-core";
import type { RenderedEmail } from "@/lib/email/send";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { getStorefrontUrl } from "@/lib/storefront-url";

export {
  MANUAL_RESERVATION_EMAIL_TEMPLATE_IDS,
  type ManualReservationEmailPayload,
  type ManualReservationEmailTemplateId,
} from "@/lib/email/manual-reservation-email-core";

interface ManualReservationEmailStore {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  darkLogoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  theme?: { mode?: "light" | "dark"; primaryColor?: string } | null;
  settings?: { currency?: string; country?: string; timezone?: string } | null;
  emailSettings?: EmailSettings | null;
  stripeAccountId?: string | null;
  stripeChargesEnabled?: boolean | null;
}

interface ManualReservationEmailReservation {
  id: string;
  number: string;
  startDate: Date;
  endDate: Date;
  totalAmount: string;
  depositAmount: string;
  customer: { firstName: string; lastName: string; email: string };
  items: { productSnapshot: { name: string }; quantity: number; totalPrice: string }[];
  payments?: { type: string; status: string }[];
  signedAt: Date | null;
}

interface BuildManualReservationEmailParams {
  store: ManualReservationEmailStore;
  reservation: ManualReservationEmailReservation;
  payload: ManualReservationEmailPayload;
  /**
   * A preview must not mint an instant-access token — that would hand out a live
   * credential for an email nobody sent — and inlines the logo, since a `cid:`
   * reference only resolves inside a real message.
   */
  mode: "send" | "preview";
  /** Access link already minted by the caller, which owns its activity log. */
  accessUrl?: string;
}

export type BuildManualReservationEmailResult =
  | ({
      to: string;
      /** `email_logs.templateType` to record once sent, when historically logged. */
      logTemplateType?: string;
    } & RenderedEmail)
  | { error: string };

/**
 * Maps the db shapes onto the serializable context the isomorphic builder (and
 * the dashboard's client-side preview) consumes. The logo is resolved to an
 * absolute URL (preview variant — browsers render SVG natively).
 */
export async function toManualEmailRenderContext(
  store: ManualReservationEmailStore,
  reservation: ManualReservationEmailReservation,
): Promise<ManualEmailRenderContext> {
  const logo = await resolveEmailLogo(getLogoForLightBackground(store), { preview: true });

  const isPaid = (reservation.payments ?? []).some(
    (payment) => payment.type === "rental" && payment.status === "completed",
  );
  const isStripeEnabled = Boolean(store.stripeAccountId && store.stripeChargesEnabled);

  return {
    store: {
      name: store.name,
      email: store.email,
      phone: store.phone,
      address: store.address,
      theme: store.theme,
      settings: store.settings,
      emailSettings: store.emailSettings,
    },
    customer: {
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
    },
    reservation: {
      id: reservation.id,
      number: reservation.number,
      startDate: reservation.startDate.toISOString(),
      endDate: reservation.endDate.toISOString(),
      totalAmount: reservation.totalAmount,
      depositAmount: reservation.depositAmount,
      items: reservation.items.map((item) => ({
        name: item.productSnapshot.name,
        quantity: item.quantity,
        totalPrice: item.totalPrice,
      })),
    },
    reservationUrl: getStorefrontUrl(store.slug, `/account/reservations/${reservation.id}`),
    logoUrl: logo.url,
    showPaymentCta: !isPaid && isStripeEnabled,
    contractSigned: reservation.signedAt !== null,
  };
}

export async function buildManualReservationEmail({
  store,
  reservation,
  payload,
  mode,
  accessUrl,
}: BuildManualReservationEmailParams): Promise<BuildManualReservationEmailResult> {
  const context = await toManualEmailRenderContext(store, reservation);

  if (mode === "preview") {
    const result = await buildManualReservationEmailFromContext(context, payload);
    return "error" in result ? result : { ...result, attachments: [] };
  }

  // A real send earns the real links (freshly minted access tokens) and an
  // email-client-safe logo (SVGs become an inline cid: PNG attachment).
  const logo = await resolveEmailLogo(getLogoForLightBackground(store));
  const options: BuildManualEmailFromContextOptions = { logoUrl: logo.url };

  const asksForSignature =
    !reservation.signedAt &&
    (payload.templateId === "contract" || payload.templateId === "reminder_pickup");

  if (asksForSignature) {
    options.contractSignatureUrl = await createReservationInstantAccessUrl({
      storeId: store.id,
      storeSlug: store.slug,
      customerEmail: reservation.customer.email,
      reservationId: reservation.id,
    });
  } else if (payload.templateId === "contract") {
    options.contractUrl = await createReservationInstantAccessUrl({
      storeId: store.id,
      storeSlug: store.slug,
      customerEmail: reservation.customer.email,
      reservationId: reservation.id,
      redirectPath: `/account/reservations/${reservation.id}/contract`,
    });
  }

  if (payload.templateId === "access_link") {
    options.accessUrl =
      accessUrl ??
      (await createReservationInstantAccessUrl({
        storeId: store.id,
        storeSlug: store.slug,
        customerEmail: reservation.customer.email,
        reservationId: reservation.id,
      }));
  }

  const result = await buildManualReservationEmailFromContext(context, payload, options);
  return "error" in result ? result : { ...result, attachments: logo.attachments };
}
