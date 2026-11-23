"use client";

import { useState } from "react";

import { ChevronsUpDown, Package, Plus } from "lucide-react";

import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from "@louez/ui";
import { cn } from "@louez/utils";

import type { ReservationProductBundle } from "@/app/(dashboard)/dashboard/reservations/new/types";

interface BundleAddComboboxProps {
  bundles: ReservationProductBundle[];
  onAddBundle: (bundle: ReservationProductBundle) => void;
  onBeforeOpen?: () => boolean;
  className?: string;
}

export const BundleAddCombobox = ({
  bundles,
  onAddBundle,
  onBeforeOpen,
  className,
}: BundleAddComboboxProps) => {
  const [open, setOpen] = useState(false);

  if (bundles.length === 0) {
    return null;
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && onBeforeOpen && !onBeforeOpen()) {
      return;
    }
    setOpen(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={cn("justify-between gap-2", className)}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Package className="size-4 shrink-0" />
          <span className="truncate">Wybierz zestaw</span>
          <Badge variant="tertiary" className="ml-0.5 shrink-0">
            {bundles.length}
          </Badge>
        </span>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2 sm:w-96">
        <div className="flex flex-col gap-1.5">
          <div className="px-2 py-1">
            <p className="text-xs font-semibold">Gotowe zestawy produktów</p>
            <p className="text-muted-foreground text-[11px]">
              Kliknij wybrany zestaw, aby dodać wszystkie jego produkty do rezerwacji.
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              {bundles.map((bundle) => (
                <button
                  key={bundle.id}
                  type="button"
                  onClick={() => {
                    onAddBundle(bundle);
                    setOpen(false);
                  }}
                  className="hover:bg-muted/70 flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{bundle.name}</p>
                      {bundle.description ? (
                        <p className="text-muted-foreground line-clamp-2 text-[11px]">
                          {bundle.description}
                        </p>
                      ) : null}
                    </div>
                    <span className="bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium">
                      <Plus className="size-3" />
                      Dodaj
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {bundle.items.map((item) => (
                      <Badge
                        key={item.productId}
                        variant="tertiary"
                        className="text-[11px] font-normal"
                      >
                        <span className="font-semibold">{item.quantity}×</span>&nbsp;
                        {item.productName}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
