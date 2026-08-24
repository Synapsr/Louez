"use client";

import { Fragment, useMemo, useState } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMessages, useTranslations } from "next-intl";

import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "@louez/ui";
import { cn } from "@louez/utils";

import {
  SETTINGS_NAVIGATION_GROUPS,
  SETTINGS_NAVIGATION_ITEMS,
  type SettingsNavigationItem,
} from "./settings-navigation.constants";
import { buildSettingsSearchHref } from "./util.settings-search-focus";
import {
  getMessageText,
  getSearchableMessageText,
  getSettingsSearchScore,
} from "./util.settings-search";

type SettingsSearchDocument = SettingsNavigationItem & {
  content: string;
  description: string;
  label: string;
};

type IndexedSettingsNavigationItem = SettingsSearchDocument & {
  score: number;
};

type SettingsSearchGroup = {
  items: IndexedSettingsNavigationItem[];
  value: string;
};

type SettingsNavProps = {
  isPlatformAdmin?: boolean;
  electronicInvoicingEnabled?: boolean;
};

export const SettingsNav = ({
  isPlatformAdmin = false,
  electronicInvoicingEnabled = true,
}: SettingsNavProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const messages = useMessages();
  const t = useTranslations("dashboard.settings.settingsNavigation");

  const availableItems = useMemo(
    () =>
      SETTINGS_NAVIGATION_ITEMS.filter(
        (item) =>
          (!item.platformAdminOnly || isPlatformAdmin) &&
          (!item.requiresElectronicInvoicing || electronicInvoicingEnabled),
      ),
    [isPlatformAdmin, electronicInvoicingEnabled],
  );

  const navigationGroups = useMemo(
    () =>
      SETTINGS_NAVIGATION_GROUPS.map((group) => ({
        group,
        items: availableItems.filter((item) => item.navigation && item.group === group),
      })),
    [availableItems],
  );

  const searchDocuments = useMemo(
    () =>
      availableItems.map((item) => ({
        ...item,
        content: getSearchableMessageText(messages, item.searchPaths),
        description: getMessageText(messages, item.descriptionPath),
        label: getMessageText(messages, item.labelPath),
      })),
    [availableItems, messages],
  );

  const searchGroups = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }

    const indexedItems = searchDocuments
      .map((item) => {
        const score = getSettingsSearchScore({ ...item, query: searchQuery });

        return score === null ? null : { ...item, score };
      })
      .filter((item): item is IndexedSettingsNavigationItem => item !== null)
      .sort((left, right) => left.score - right.score);

    return SETTINGS_NAVIGATION_GROUPS.map((group) => ({
      value: t(`groups.${group}`),
      items: indexedItems.filter((item) => item.group === group),
    })).filter((group) => group.items.length > 0);
  }, [searchDocuments, searchQuery, t]);

  const isActive = (href: string) => {
    if (href === "/dashboard/settings") {
      return pathname === href;
    }

    return pathname.startsWith(href);
  };

  const currentItem = availableItems.find((item) => item.navigation && isActive(item.href));
  const hasSearch = searchQuery.trim().length > 0;

  const navigateTo = (href: string) => {
    setSearchQuery("");
    router.push(href);
  };

  const navigateToSearchMatch = (item: IndexedSettingsNavigationItem) => {
    router.push(buildSettingsSearchHref({ href: item.href, itemId: item.id, query: searchQuery }));
    setSearchQuery("");
  };

  return (
    <aside className="min-w-0">
      <div className="xl:sticky xl:top-6">
        <Command
          open
          filter={null}
          items={searchGroups}
          value={searchQuery}
          onValueChange={setSearchQuery}
          itemToStringValue={(itemValue) => {
            if (
              typeof itemValue !== "object" ||
              itemValue === null ||
              !("label" in itemValue) ||
              typeof itemValue.label !== "string"
            ) {
              return "";
            }

            return itemValue.label;
          }}
        >
          <CommandInput
            className={cn(
              "border shadow-[0_0_1px_0.5px_var(--color-border)] has-focus-visible:shadow-[0_0_1px_0.5px_var(--color-border)]!  has-focus-visible:ring-1",
            )}
            aria-label={t("search.label")}
            autoFocus={false}
            placeholder={t("search.placeholder")}
            showClear
            size="default"
          />

          {hasSearch && (
            <CommandPanel className="mx-0 mt-1 rounded-xl border-b [clip-path:none] not-has-[+[data-slot=command-footer]]:mb-0 not-has-[+[data-slot=command-footer]]:rounded-b-xl not-has-[+[data-slot=command-footer]]:[clip-path:none]">
              <CommandEmpty>{t("search.noResults")}</CommandEmpty>
              <CommandList className="max-h-[calc(100dvh-17rem)]">
                {(group: SettingsSearchGroup, groupIndex: number) => (
                  <Fragment key={group.value}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.value}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: IndexedSettingsNavigationItem) => (
                          <CommandItem
                            key={item.id}
                            value={item}
                            className="items-start gap-2.5 py-2"
                            onClick={() => navigateToSearchMatch(item)}
                          >
                            <item.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{item.label}</span>
                              <span className="text-muted-foreground line-clamp-2 block text-xs">
                                {item.description}
                              </span>
                            </span>
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </CommandGroup>
                    {groupIndex < searchGroups.length - 1 && <CommandSeparator />}
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
          )}
        </Command>

        {!hasSearch && (
          <>
            <div className="mt-3 xl:hidden">
              <select
                aria-label={t("mobileLabel")}
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={currentItem?.href ?? "/dashboard/settings"}
                onChange={(event) => navigateTo(event.currentTarget.value)}
              >
                {navigationGroups.map(({ group, items }) => (
                  <optgroup key={group} label={t(`groups.${group}`)}>
                    {items.map((item) => (
                      <option key={item.id} value={item.href}>
                        {getMessageText(messages, item.labelPath)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <nav className="mt-5 hidden xl:block" aria-label={t("label")}>
              <div className="space-y-5">
                {navigationGroups.map(({ group, items }) => (
                  <section key={group} aria-labelledby={`settings-group-${group}`}>
                    <h2
                      id={`settings-group-${group}`}
                      className="text-muted-foreground mb-1.5 px-3 text-[11px] font-semibold tracking-wider uppercase"
                    >
                      {t(`groups.${group}`)}
                    </h2>
                    <div className="space-y-0.5">
                      {items.map((item) => {
                        const active = isActive(item.href);

                        return (
                          <Link
                            key={item.id}
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                              active
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <item.icon className="size-4 shrink-0" />
                            <span className="truncate">
                              {getMessageText(messages, item.labelPath)}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </nav>
          </>
        )}
      </div>
    </aside>
  );
};
