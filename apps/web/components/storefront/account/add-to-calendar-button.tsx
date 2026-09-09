"use client";

import { CalendarPlusIcon, ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Menu, MenuItem, MenuPopup, MenuTrigger } from "@louez/ui";

interface AddToCalendarButtonProps {
  links: { google: string; outlook: string; office: string };
}

export const AddToCalendarButton = ({ links }: AddToCalendarButtonProps) => {
  const t = useTranslations("storefront.account.calendar");
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" className="max-w-full" />}>
        <CalendarPlusIcon aria-hidden className="size-4" />
        <span className="whitespace-normal text-start">{t("add")}</span>
        <ChevronDownIcon aria-hidden className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem render={<a href={links.google} target="_blank" rel="noopener noreferrer" />}>
          Google Calendar
        </MenuItem>
        <MenuItem render={<a href={links.outlook} target="_blank" rel="noopener noreferrer" />}>
          Outlook.com
        </MenuItem>
        <MenuItem render={<a href={links.office} target="_blank" rel="noopener noreferrer" />}>
          Microsoft 365
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
};
