"use client";
import { ShoppingBagIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { cn } from "@louez/utils";
export const CartTriggerView = ({
  count,
  open,
  className,
}: {
  count: number;
  open: () => void;
  className?: string;
}) => {
  const t = useTranslations("storefront.cart");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={count > 0 ? t("openWithCount", { count }) : t("open")}
      className={cn("relative size-12 rounded-full", className)}
      onClick={open}
    >
      <ShoppingBagIcon aria-hidden className="size-5" />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold tabular-nums text-primary-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Button>
  );
};
