"use client";

import type { ReactNode } from "react";

import { cn } from "@louez/utils";

import type { CustomerExtraItem } from "./util.customer-extra-layout";

interface CustomerExtraFieldsGridProps<TProfileField, TCustomField> {
  /** In the owner's layout (`joinCustomerExtraLayout`). */
  items: readonly CustomerExtraItem<TProfileField, TCustomField>[];
  /** The input of one field: bound to a form, or static in the owner's preview. */
  renderItem: (item: CustomerExtraItem<TProfileField, TCustomField>) => ReactNode;
  className?: string;
}

/**
 * The store's questions (Louez's and its own) as the owner laid them out:
 * one grid, two columns on a wide screen, a full-width field on its own row.
 */
export const CustomerExtraFieldsGrid = <TProfileField, TCustomField>({
  items,
  renderItem,
  className,
}: CustomerExtraFieldsGridProps<TProfileField, TCustomField>) => (
  <div className={cn("grid items-start gap-x-3 gap-y-4 sm:grid-cols-2", className)}>
    {items.map((item) => (
      <div
        key={`${item.kind}:${item.key}`}
        className={cn("min-w-0", item.width === "full" && "sm:col-span-2")}
      >
        {renderItem(item)}
      </div>
    ))}
  </div>
);
