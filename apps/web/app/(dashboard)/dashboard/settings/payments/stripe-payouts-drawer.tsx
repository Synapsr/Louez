"use client";

import { useEffect, useRef, useState } from "react";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Button,
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@louez/ui";
import { ArrowRightIcon, RepeatSolidIcon, SpinnerSolidIcon } from "@louez/ui/icons";
import { useIsMobile } from "@louez/ui/hooks/use-mobile";

import type { ConnectedAccountPayoutPage } from "@/lib/stripe/connected-account-finances";
import { stripeFinancesQueries } from "@/lib/queries/stripe-finances.queries";

import { StripePayoutList } from "./stripe-payout-list";

interface StripePayoutsDrawerProps {
  initialPage: ConnectedAccountPayoutPage;
}

export const StripePayoutsDrawer = ({ initialPage }: StripePayoutsDrawerProps) => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("dashboard.settings.payments.finances");
  const query = useInfiniteQuery(stripeFinancesQueries.payouts(initialPage));
  const payouts = query.data.pages.flatMap((page) => page.items);

  useEffect(() => {
    const target = loadMoreRef.current;

    if (
      !open ||
      !target ||
      !query.hasNextPage ||
      query.isFetchingNextPage ||
      query.isFetchNextPageError
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void query.fetchNextPage();
        }
      },
      {
        rootMargin: "0px 0px 160px",
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [
    open,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchNextPageError,
    query.isFetchingNextPage,
  ]);

  return (
    <Drawer position={isMobile ? "bottom" : "right"} open={open} onOpenChange={setOpen}>
      <DrawerTrigger render={<Button size="sm" variant="ghost" />}>
        {t("viewMore")}
        <ArrowRightIcon />
      </DrawerTrigger>

      <DrawerPopup
        className={isMobile ? "max-h-[85dvh]" : "max-w-xl"}
        showCloseButton
        variant={isMobile ? "default" : "inset"}
      >
        <DrawerHeader>
          <DrawerTitle>{t("drawerTitle")}</DrawerTitle>
          <DrawerDescription>{t("drawerDescription")}</DrawerDescription>
        </DrawerHeader>
        <DrawerPanel>
          <div className="space-y-3">
            <StripePayoutList payouts={payouts} />

            {query.hasNextPage ? (
              <div ref={loadMoreRef} aria-live="polite" className="flex min-h-10 justify-center">
                {query.isFetchNextPageError ? (
                  <Button onClick={() => void query.fetchNextPage()} size="sm" variant="ghost">
                    <RepeatSolidIcon />
                    {t("retry")}
                  </Button>
                ) : query.isFetchingNextPage ? (
                  <span
                    aria-label={t("loadingMore")}
                    className="text-muted-foreground inline-flex items-center gap-2 text-sm"
                    role="status"
                  >
                    <SpinnerSolidIcon aria-hidden="true" className="size-4 animate-spin" />
                    {t("loadingMore")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
};
