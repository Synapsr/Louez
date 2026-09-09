"use client";

import { type ReactNode, useState } from "react";

import { SlidersHorizontalIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Badge,
  Button,
  Drawer,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@louez/ui";
import { cn } from "@louez/utils";

import { useMediaQuery } from "@/hooks/use-media-query";

interface CatalogFiltersDrawerProps {
  /** Filters the visitor has set, shown as a badge on the trigger. */
  activeCount: number;
  /** Products the current filters match, named on the confirm button. */
  resultCount: number;
  /** The sidebar; the same one the desktop column renders. */
  children: ReactNode;
  className?: string;
}

/** Filters open below on mobile and beside the catalog on desktop. */
export const CatalogFiltersDrawer = ({
  activeCount,
  resultCount,
  children,
  className,
}: CatalogFiltersDrawerProps) => {
  const t = useTranslations("storefront.catalog");
  const [isOpen, setOpen] = useState(false);
  const isSidePanel = useMediaQuery("(min-width: 1024px)");

  return (
    <Drawer open={isOpen} onOpenChange={setOpen} position={isSidePanel ? "right" : "bottom"}>
      <DrawerTrigger
        render={<Button variant="outline" className={className} aria-label={t("filters")} />}
      >
        <SlidersHorizontalIcon className="size-4 text-muted-foreground" aria-hidden />
        <span>{t("filters")}</span>
        {activeCount > 0 ? (
          <Badge size="sm" variant="default" aria-hidden>
            {activeCount}
          </Badge>
        ) : null}
      </DrawerTrigger>

      <DrawerPopup
        variant="inset"
        showCloseButton={isSidePanel}
        className={cn(isSidePanel ? "w-full max-w-sm" : "max-h-[85dvh]")}
      >
        <DrawerHeader>
          <DrawerTitle className="text-xl font-semibold tracking-tight">{t("filters")}</DrawerTitle>
        </DrawerHeader>

        <DrawerPanel>{children}</DrawerPanel>

        <DrawerFooter variant="bare">
          <Button type="button" size="xl" className="w-full" onClick={() => setOpen(false)}>
            {t("showResults", { count: resultCount })}
          </Button>
        </DrawerFooter>
      </DrawerPopup>
    </Drawer>
  );
};
