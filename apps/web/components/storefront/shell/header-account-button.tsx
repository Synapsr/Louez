"use client";

import { CalendarDaysIcon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator } from "@louez/ui";
import { LogoutButton } from "@/components/storefront/logout-button";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";

interface HeaderAccountButtonProps {
  initials?: string | null;
  customer?: { firstName: string; lastName: string; email: string } | null;
}

export const HeaderAccountButton = ({ initials, customer }: HeaderAccountButtonProps) => {
  const t = useTranslations("storefront");
  const className =
    "flex h-12 items-center gap-2 rounded-full border border-transparent px-1.5 text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:border-border lg:ps-3";

  if (!customer)
    return (
      <StorefrontLink href="/account/login" aria-label={t("header.signIn")} className={className}>
        <span className="hidden text-sm font-medium lg:inline">{t("header.signIn")}</span>
        <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-muted">
          <UserIcon className="size-4" />
        </span>
      </StorefrontLink>
    );

  return (
    <Menu>
      <MenuTrigger aria-label={t("header.myAccount")} className={className}>
        <span className="hidden text-sm font-medium lg:inline">{t("header.myAccount")}</span>
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {initials || <UserIcon className="size-4" />}
        </span>
      </MenuTrigger>
      <MenuPopup
        align="end"
        sideOffset={8}
        className="w-72 max-w-[calc(100vw-2rem)] rounded-2xl before:rounded-[calc(var(--radius-2xl)-1px)] [&_[data-slot=menu-item]]:rounded-[calc(var(--radius-2xl)-var(--spacing)-1px)]"
      >
        <div className="px-3 py-3">
          <p className="truncate text-sm font-semibold">
            {`${customer.firstName} ${customer.lastName}`.trim()}
          </p>
          <p className="truncate text-sm text-muted-foreground">{customer.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem
          className="min-h-11 px-3 sm:min-h-11 [&>svg]:mx-0"
          render={<StorefrontLink href="/account" />}
        >
          <CalendarDaysIcon aria-hidden />
          {t("account.myReservations")}
        </MenuItem>
        <MenuItem
          className="min-h-11 px-3 sm:min-h-11 [&>svg]:mx-0"
          render={<StorefrontLink href="/account/profile" />}
        >
          <UserIcon aria-hidden />
          {t("account.profile.title")}
        </MenuItem>
        <MenuSeparator />
        <LogoutButton menuItem />
      </MenuPopup>
    </Menu>
  );
};
