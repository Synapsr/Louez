"use client";

import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, MoreHorizontal, Undo2 } from "lucide-react";

import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toastManager,
} from "@louez/ui";
import type { StripeDashboardKind } from "@louez/api/adapters/stripe-connect";

import { stripeRefundsMutations } from "@/lib/queries/stripe-refunds.queries";

import { useStripeRefundRefusalText } from "./use-stripe-refund-refusal-text";
import {
  type StripeRefundAvailability,
  type StripeRefundBlock,
  stripeRefundRefusalOf,
} from "./util.stripe-refund";

interface StripePaymentRowActionsProps {
  paymentId: string;
  refund: StripeRefundAvailability;
  /** Stripe holds a payment for the row: its dashboard can open it. */
  opensInStripe: boolean;
  /** The member may open the store's Stripe dashboard (`manage_settings`). */
  canOpenStripe: boolean;
  /** The dashboard Stripe gives the store's account; null when it could not be read. */
  dashboardKind: StripeDashboardKind | null;
  readOnly: boolean;
  onRefund: () => void;
}

const BLOCK_KEYS: Record<StripeRefundBlock, string> = {
  disputed: "disputed",
  not_settled: "notSettled",
  no_permission: "noPermission",
};

/** The Stripe link's label: honest about where it leads, for each kind of account. */
const OPEN_LABELS: Record<StripeDashboardKind | "unknown", string> = {
  full: "viewInStripe",
  express: "openStripeSpace",
  unknown: "openInStripe",
};

/**
 * A Stripe payment row's actions, behind one "⋯" button the row shows on hover and on
 * keyboard focus (always on touch): refund it, and open it in Stripe. A refund that
 * cannot be sent yet stays in the menu, disabled, with why.
 */
export const StripePaymentRowActions = ({
  paymentId,
  refund,
  opensInStripe,
  canOpenStripe,
  dashboardKind,
  readOnly,
  onRefund,
}: StripePaymentRowActionsProps) => {
  const t = useTranslations("dashboard.reservations.payment.stripeRefund");
  const refusalText = useStripeRefundRefusalText();
  const openMutation = useMutation(stripeRefundsMutations.openInStripe());

  if (refund.state === "hidden" && !opensInStripe) return null;

  const openInStripe = async () => {
    // Opened at once, from the click: a tab opened once the answer is back is blocked.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await openMutation.mutateAsync({ paymentId });
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
    } catch (error) {
      tab?.close();
      toastManager.add({ title: refusalText(stripeRefundRefusalOf(error)), type: "error" });
    }
  };

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            disabled={readOnly}
            aria-label={t("actions")}
            className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 pointer-coarse:opacity-100"
          />
        }
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {refund.state === "available" && (
          <MenuItem onClick={onRefund}>
            <Undo2 />
            {t("action")}
          </MenuItem>
        )}
        {refund.state === "disabled" && (
          <Tooltip>
            <TooltipTrigger
              render={<MenuItem disabled className="data-disabled:pointer-events-auto" />}
            >
              <Undo2 />
              <span className="flex flex-col">
                <span>{t("action")}</span>
                <span className="text-xs font-normal">
                  {t(`blocked.${BLOCK_KEYS[refund.reason]}`)}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t(`blockedHint.${BLOCK_KEYS[refund.reason]}`)}</TooltipContent>
          </Tooltip>
        )}
        {opensInStripe &&
          (canOpenStripe ? (
            <MenuItem onClick={openInStripe} disabled={openMutation.isPending}>
              <ExternalLink />
              {t(OPEN_LABELS[dashboardKind ?? "unknown"])}
            </MenuItem>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={<MenuItem disabled className="data-disabled:pointer-events-auto" />}
              >
                <ExternalLink />
                {t(OPEN_LABELS[dashboardKind ?? "unknown"])}
              </TooltipTrigger>
              <TooltipContent>{t("blockedHint.stripePermission")}</TooltipContent>
            </Tooltip>
          ))}
      </MenuPopup>
    </Menu>
  );
};
