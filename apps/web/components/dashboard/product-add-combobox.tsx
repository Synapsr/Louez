"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronsUpDown } from "lucide-react";

import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Drawer,
  DrawerFooter,
  DrawerHeader,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@louez/ui";
import { useIsMobile } from "@louez/ui/hooks/use-mobile";
import { cn } from "@louez/utils";
import type { StockQuantityLimit } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";

export interface ProductAddComboboxProduct {
  id: string;
  name: string;
  images?: string[] | null;
}

interface ProductAddComboboxProps {
  products: ProductAddComboboxProduct[];
  availableQuantityByProduct: Map<string, StockQuantityLimit>;
  onAddProduct: (productId: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  unavailableLabel: string;
  availableLabel: string;
  /** Closes the sheet on mobile, where adding several products keeps it open. */
  doneLabel: string;
  /** Quantity already on the reservation, shown per row so the list doubles as a recap. */
  selectedQuantityByProduct?: Map<string, number>;
  disabled?: boolean;
  /** Return false to keep the popover closed (e.g. a prerequisite is missing). */
  onBeforeOpen?: () => boolean;
  /** Applied to the trigger, so callers can size it inside their own row. */
  className?: string;
}

export function ProductAddCombobox({
  products,
  availableQuantityByProduct,
  onAddProduct,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  unavailableLabel,
  availableLabel,
  doneLabel,
  selectedQuantityByProduct,
  disabled = false,
  onBeforeOpen,
  className,
}: ProductAddComboboxProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const justAddedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (justAddedTimeoutRef.current) clearTimeout(justAddedTimeoutRef.current);
    },
    [],
  );

  // The default CommandInput autoFocus fires before the popover is anchored,
  // making the browser scroll to the not-yet-positioned popup. Focus manually
  // once open, with preventScroll so the page never jumps. On the phone nobody
  // is focused: the sheet would open under a virtual keyboard covering the very
  // list it exists to show, and the search field is one tap away.
  useEffect(() => {
    if (!open || isMobile) return;

    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isMobile, open]);

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Adding leaves the list open, so the tap needs an answer inside the list
  // itself: the count badge pops, then settles back to rest.
  const flagJustAdded = (productId: string) => {
    setJustAddedId(productId);
    if (justAddedTimeoutRef.current) clearTimeout(justAddedTimeoutRef.current);
    justAddedTimeoutRef.current = setTimeout(() => setJustAddedId(null), 220);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && onBeforeOpen && !onBeforeOpen()) {
      return;
    }
    setOpen(nextOpen);
  };

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      disabled={disabled}
      className={cn("group h-9 w-fit justify-between", className)}
    />
  );

  const triggerChildren = (
    <>
      <span className="w-full min-w-0 flex-1 justify-start gap-2">
        <span className="truncate">{placeholder}</span>
      </span>
      <ChevronsUpDown
        data-slot="icon"
        className="size-4 opacity-70 transition-opacity group-hover:opacity-100"
      />
    </>
  );

  const command = (
    <Command open items={filteredProducts} filter={null}>
      <CommandInput
        ref={searchInputRef}
        autoFocus={false}
        placeholder={searchPlaceholder}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
      <CommandEmpty>{emptyLabel}</CommandEmpty>
      {/* The list owns the scrolling in both shells, so the sheet never stacks
          its own scroll container on top of this one. */}
      <CommandList className={cn("max-h-80 not-empty:pt-0", isMobile && "max-h-[50vh]")}>
        <CommandGroup>
          {filteredProducts.map((product) => {
            const remaining = availableQuantityByProduct.get(product.id);
            const isUnavailable =
              remaining !== undefined && remaining !== null && remaining <= 0;
            const selectedQuantity = selectedQuantityByProduct?.get(product.id) ?? 0;

            return (
              <CommandItem
                key={product.id}
                value={product.id}
                onClick={() => {
                  // Keep the popover open so several products can be
                  // added in a row; Escape or an outside click closes it.
                  onAddProduct(product.id);
                  flagJustAdded(product.id);
                  setSearchQuery("");
                }}
                // Press feedback is felt more than seen: the row gives under
                // the finger, so the tap registers before the list updates.
                className="flex items-center gap-2 transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:active:scale-100"
              >
                <ProductImage
                  src={product.images?.[0]}
                  alt=""
                  sizes="32px"
                  className={cn(isUnavailable && "opacity-40")}
                  containerClassName="w-8 shrink-0 rounded-md"
                />

                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    isUnavailable && "text-muted-foreground",
                  )}
                >
                  {product.name}
                </span>
                {selectedQuantity > 0 && (
                  <Badge
                    className={cn(
                      "shrink-0 tabular-nums transition-transform duration-150 ease-out",
                      justAddedId === product.id && "scale-110",
                      "motion-reduce:scale-100",
                    )}
                  >
                    ×{selectedQuantity}
                  </Badge>
                )}
                {isUnavailable ? (
                  <Badge variant="pending" size="default">
                    {unavailableLabel}
                  </Badge>
                ) : (
                  remaining !== undefined && (
                    <Badge variant="expired" className="tabular-nums">
                      {remaining === null ? availableLabel : `${remaining} ${availableLabel}`}
                    </Badge>
                  )
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  if (isMobile) {
    // Anchored to a button that can sit anywhere in a long form, the popover
    // has no room left on a phone — a sheet gets the full width and a list
    // that can breathe.
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} position="bottom">
        <DrawerTrigger render={trigger}>{triggerChildren}</DrawerTrigger>
        <DrawerPopup showCloseButton>
          <DrawerHeader className="pb-2">
            <DrawerTitle>{placeholder}</DrawerTitle>
          </DrawerHeader>
          {/* touch-auto, as DrawerPanel does: the popup is touch-none so it
              can be swiped away, which would otherwise eat the list's scroll. */}
          <div className="flex min-h-0 touch-auto flex-col px-2">{command}</div>
          {/* Tapping a product keeps the sheet open so several can be added in
              a row, so the phone needs an explicit way out. */}
          <DrawerFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              {doneLabel}
            </Button>
          </DrawerFooter>
        </DrawerPopup>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={trigger}>{triggerChildren}</PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0 pt-1 sm:w-90 *:p-0"
        align="end"
      >
        {command}
      </PopoverContent>
    </Popover>
  );
}
