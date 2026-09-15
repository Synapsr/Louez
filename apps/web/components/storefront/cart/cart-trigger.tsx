"use client";
import { useCartDrawer, useCartState } from "@/contexts/cart-context";
import { CartTriggerView } from "./cart-trigger-view";
export const CartTrigger = ({ className }: { className?: string }) => {
  const { summary } = useCartState();
  const { open } = useCartDrawer();
  return <CartTriggerView count={summary.count} open={open} className={className} />;
};
