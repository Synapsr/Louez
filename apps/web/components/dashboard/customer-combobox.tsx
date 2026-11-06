"use client";

import * as React from "react";

import { Check, ChevronsUpDown, Search, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import {
  Command,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@louez/ui";
import {
  Drawer,
  DrawerFooter,
  DrawerHeader,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@louez/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@louez/ui";
import { Avatar, AvatarFallback } from "@louez/ui";
import { useIsMobile } from "@louez/ui/hooks/use-mobile";
import { cn } from "@louez/utils";

import type { DashboardCustomer } from "./customer.types";

interface CustomerComboboxProps {
  customers: DashboardCustomer[];
  value: string;
  onValueChange: (value: string) => void;
  /** When provided, a create action is pinned under the list and receives the current search. */
  onCreateRequest?: (query: string) => void;
  disabled?: boolean;
  className?: string;
}

export function CustomerCombobox({
  customers,
  value,
  onValueChange,
  onCreateRequest,
  disabled = false,
  className,
}: CustomerComboboxProps) {
  const t = useTranslations("common.customerSearch");
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const scrollPositionRef = React.useRef<{ x: number; y: number } | null>(null);
  // Set while closing to hand over to a dialog, so the popover doesn't steal focus back.
  const skipFinalFocusRef = React.useRef(false);

  const selectedCustomer = customers.find((customer) => customer.id === value);

  const filteredCustomers = React.useMemo(() => {
    if (!searchQuery) return customers;

    const query = searchQuery.toLowerCase();
    return customers.filter((customer) => {
      const fullName = `${customer.firstName} ${customer.lastName}`.toLowerCase();
      const email = customer.email?.toLowerCase() ?? "";
      const phone = customer.phone?.toLowerCase() || "";

      return fullName.includes(query) || email.includes(query) || phone.includes(query);
    });
  }, [customers, searchQuery]);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      // Anchoring the popover can scroll the page to the popup; snapping back
      // on the next frame keeps the form where it was. The sheet is anchored to
      // nothing and locks the page anyway, so it never needs the correction.
      if (nextOpen && !isMobile) {
        scrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
        window.requestAnimationFrame(() => {
          const scrollPosition = scrollPositionRef.current;

          if (!scrollPosition) return;

          window.scrollTo(scrollPosition.x, scrollPosition.y);
        });
      } else {
        scrollPositionRef.current = null;
      }

      setOpen(nextOpen);
    },
    [isMobile],
  );

  const handleCreateRequest = () => {
    if (!onCreateRequest) return;

    skipFinalFocusRef.current = true;
    setOpen(false);
    onCreateRequest(searchQuery);
    setSearchQuery("");
  };

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn(
        "h-auto min-h-[44px] w-full min-w-0 justify-between py-2 *:w-full",
        !value && "text-muted-foreground",
        className,
      )}
      disabled={disabled}
    />
  );

  const triggerChildren = (
    <>
      {selectedCustomer ? (
        <div className="flex min-w-0 items-center gap-3 w-full">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {getInitials(selectedCustomer.firstName, selectedCustomer.lastName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-left">
            <p className="text-foreground truncate font-medium">
              {selectedCustomer.firstName} {selectedCustomer.lastName}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {selectedCustomer.email ?? selectedCustomer.phone}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 w-full">
          <Search className="h-4 w-4" />
          <span>{t("selectCustomer")}</span>
        </div>
      )}
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </>
  );

  const createLabel = searchQuery.trim()
    ? t("createNamed", { query: searchQuery.trim() })
    : t("createCustomer");

  // Handing over to the create dialog: neither shell may pull focus back to the
  // trigger, or the dialog opens behind a focused combobox.
  const finalFocus = () => {
    if (!skipFinalFocusRef.current) return true;

    skipFinalFocusRef.current = false;
    return false;
  };

  const command = (
    <Command open items={filteredCustomers}>
      <CommandInput
        autoFocus={false}
        placeholder={t("placeholder")}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <CommandEmpty>{t("noResults")}</CommandEmpty>
      {/* The list owns the scrolling in both shells, so the sheet never stacks
          its own scroll container on top of this one. */}
      <CommandList
        className={cn("max-h-[min(calc(100vh-12rem),22rem)]", isMobile && "max-h-[50vh]")}
      >
        <CommandGroup>
          {filteredCustomers.map((customer) => (
            <CommandItem
              key={customer.id}
              value={customer.id}
              onClick={() => {
                onValueChange(customer.id === value ? "" : customer.id);
                setOpen(false);
                setSearchQuery("");
              }}
              className="flex items-center gap-3 py-3"
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {getInitials(customer.firstName, customer.lastName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {customer.firstName} {customer.lastName}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {customer.email ?? customer.phone}
                </p>
              </div>
              {customer.phone && (
                <span className="text-muted-foreground max-w-24 truncate text-xs">
                  {customer.phone}
                </span>
              )}
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  value === customer.id ? "opacity-100" : "opacity-0",
                )}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      {/* On the phone the create action is a real sheet action instead of a
          row pinned under the list — see the drawer footer below. */}
      {onCreateRequest && !isMobile && (
        <CommandFooter className="p-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start gap-2 text-sm"
            onClick={handleCreateRequest}
          >
            <UserPlus className="h-4 w-4 shrink-0" />
            <span className="truncate">{createLabel}</span>
          </Button>
        </CommandFooter>
      )}
    </Command>
  );

  if (isMobile) {
    // A 400px list anchored to a full-width trigger has nowhere to go on a
    // phone — a sheet gets the width and a list that can breathe.
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} position="bottom">
        <DrawerTrigger render={trigger}>{triggerChildren}</DrawerTrigger>
        <DrawerPopup showCloseButton finalFocus={finalFocus}>
          <DrawerHeader className="pb-2">
            <DrawerTitle>{t("selectCustomer")}</DrawerTitle>
          </DrawerHeader>
          {/* touch-auto, as DrawerPanel does: the popup is touch-none so it can
              be swiped away, which would otherwise eat the list's scroll. */}
          <div
            className={cn(
              "flex min-h-0 touch-auto flex-col px-2",
              // Without a footer this is the last thing in the sheet, so it
              // owns the bottom inset itself.
              !onCreateRequest && "pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))]",
            )}
          >
            {command}
          </div>
          {onCreateRequest && (
            <DrawerFooter>
              <Button type="button" onClick={handleCreateRequest}>
                <UserPlus className="h-4 w-4 shrink-0" />
                <span className="truncate">{createLabel}</span>
              </Button>
            </DrawerFooter>
          )}
        </DrawerPopup>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={trigger}>{triggerChildren}</PopoverTrigger>
      <PopoverContent
        className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-(--available-width) p-0 pt-2 *:p-0 sm:w-100"
        align="start"
        finalFocus={finalFocus}
      >
        {command}
      </PopoverContent>
    </Popover>
  );
}
