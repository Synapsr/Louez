"use client";

import { useCallback, useMemo, useState } from "react";

import type { StockQuantityLimit } from "@louez/utils";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";

import type { StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";
import { type CartLineInput, toCartLineInput } from "@/lib/utils/util.cart-line-input";

import { useAnalytics } from "@/contexts/analytics-context";
import { useCartActions, useCartDrawer, useCartState } from "@/contexts/cart-context";
import { useStorePeriodRules } from "@/contexts/store-context";

import { type ProductCardPeriod, selectOfferableExtras } from "./util.product-card";

/** What the dialog still has to ask before, or offer after, the add. */
export type QuickAddStep = "period" | "variant" | "extras";

export interface QuickAddFlowState {
  product: StorefrontCatalogProduct;
  step: QuickAddStep;
  /** Every step this add goes through, in order, for the dialog's stepper. */
  steps: QuickAddStep[];
  quantity?: number;
  /** The period this add is on: the grid's, the cart's, or the one just chosen. */
  period: ProductCardPeriod | null;
}

export interface QuickAddFlow {
  /** The open step, or `null` while the dialog is closed. */
  state: QuickAddFlowState | null;
  /** The period of the running add; `null` before the dates step answers. */
  period: ProductCardPeriod | null;
  /**
   * Begins the add for one card. `maxQuantity` is the stock the card knows
   * of; `period` the one its grid browses, the cart's when absent.
   */
  start: (
    product: StorefrontCatalogProduct,
    maxQuantity: StockQuantityLimit,
    period: ProductCardPeriod | null,
  ) => void;
  offerExtras: (
    product: StorefrontCatalogProduct,
    period: ProductCardPeriod,
    quantity: number,
  ) => void;
  /** The dates step answered: the period becomes the cart's. */
  applyPeriod: (value: RentalPeriodValue) => void;
  /** The variant step answered with the lines to add. */
  applyVariant: (lines: CartLineInput[]) => void;
  /** The extras step is over, extras added or not: the visitor sees the cart. */
  finish: () => void;
  /** Closes the dialog. Cancels before the add; after it, shows the cart. */
  dismiss: () => void;
}

const hasVariants = (product: StorefrontCatalogProduct): boolean =>
  (product.bookingAttributeAxes?.length ?? 0) > 0;

/**
 * One-tap add from a card, and the questions it cannot skip. Without dates
 * the dialog asks for them; with a variant to pick, it asks for that; the
 * add itself then goes through, one unit with its required accessories,
 * and the optional accessories are offered last. Every step only appears
 * when the product needs it, so a simple product on a dated grid goes
 * straight to the cart drawer.
 *
 * Lives above the grids (see `QuickAddProvider`): choosing dates makes the
 * catalog underneath fetch its products again, and a flow held by a grid
 * would go with them.
 */
export const useQuickAddFlow = (): QuickAddFlow => {
  const rules = useStorePeriodRules();
  const { addItem, setPeriod, setPricingMode } = useCartActions();
  const { period: cartPeriod, items } = useCartState();
  const drawer = useCartDrawer();
  const { trackEvent } = useAnalytics();
  const [state, setState] = useState<QuickAddFlowState | null>(null);

  const cartProductIds = useMemo(() => new Set(items.map((item) => item.productId)), [items]);

  const addLines = useCallback(
    (product: StorefrontCatalogProduct, on: ProductCardPeriod, lines: CartLineInput[]) => {
      for (const line of lines) {
        addItem(line, { startDate: on.startDate, endDate: on.endDate });
      }
      trackEvent({
        eventType: "add_to_cart",
        metadata: {
          productId: product.id,
          quantity: lines.reduce((total, line) => total + line.quantity, 0),
          startDate: on.startDate,
          endDate: on.endDate,
          extras: [],
          source: "quick_add",
        },
      });
    },
    [addItem, trackEvent],
  );

  /** The steps one product's add goes through, given what is known now. */
  const planSteps = useCallback(
    (product: StorefrontCatalogProduct, period: ProductCardPeriod | null): QuickAddStep[] => [
      ...(period ? [] : (["period"] as const)),
      ...(hasVariants(product) ? (["variant"] as const) : []),
      ...(selectOfferableExtras(product.accessories, cartProductIds).length > 0
        ? (["extras"] as const)
        : []),
    ],
    [cartProductIds],
  );

  /** After the add: offer what is left to offer, or show the cart. */
  const settle = useCallback(
    (added: QuickAddFlowState) => {
      if (added.steps.includes("extras")) {
        setState({ ...added, step: "extras" });
        return;
      }
      setState(null);
      drawer.open();
    },
    [drawer],
  );

  const addOneUnit = useCallback(
    (flow: QuickAddFlowState, on: ProductCardPeriod, maxQuantity: StockQuantityLimit) => {
      addLines(flow.product, on, [toCartLineInput(flow.product, { quantity: 1, maxQuantity })]);
      settle({ ...flow, period: on });
    },
    [addLines, settle],
  );

  const start = useCallback<QuickAddFlow["start"]>(
    (product, maxQuantity, gridPeriod) => {
      const period =
        gridPeriod ??
        (cartPeriod ? { startDate: cartPeriod.startDate, endDate: cartPeriod.endDate } : null);
      const steps = planSteps(product, period);
      if (!period) {
        setState({ product, step: "period", steps, period });
        return;
      }
      if (hasVariants(product)) {
        setState({ product, step: "variant", steps, period });
        return;
      }
      addOneUnit({ product, step: "variant", steps, period }, period, maxQuantity);
    },
    [addOneUnit, cartPeriod, planSteps],
  );

  const offerExtras = useCallback<QuickAddFlow["offerExtras"]>(
    (product, period, quantity) => {
      settle({
        product,
        period,
        quantity,
        step: "extras",
        steps: planSteps(product, period).filter((step) => step === "extras"),
      });
    },
    [planSteps, settle],
  );

  const applyPeriod = useCallback<QuickAddFlow["applyPeriod"]>(
    (value) => {
      if (!state) return;
      const next = { startDate: value.start.toISOString(), endDate: value.end.toISOString() };
      // The cart takes the dates right away, so the page behind follows;
      // this flow keeps its own copy and does not depend on that.
      setPricingMode(rules.pricingMode);
      setPeriod(next.startDate, next.endDate);

      if (hasVariants(state.product)) {
        setState({ ...state, step: "variant", period: next });
        return;
      }
      // The editor checks availability before committing; the cart resolves the stock again.
      addOneUnit(state, next, state.product.quantity);
    },
    [addOneUnit, rules.pricingMode, setPeriod, setPricingMode, state],
  );

  const applyVariant = useCallback<QuickAddFlow["applyVariant"]>(
    (lines) => {
      if (!state?.period) return;
      addLines(state.product, state.period, lines);
      settle(state);
    },
    [addLines, settle, state],
  );

  const finish = useCallback(() => {
    setState(null);
    drawer.open();
  }, [drawer]);

  const dismiss = useCallback(() => {
    if (state?.step === "extras") {
      finish();
      return;
    }
    setState(null);
  }, [finish, state?.step]);

  return {
    state,
    period: state?.period ?? null,
    start,
    offerExtras,
    applyPeriod,
    applyVariant,
    finish,
    dismiss,
  };
};
