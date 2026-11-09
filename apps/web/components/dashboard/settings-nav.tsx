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
import {
  HelpGlassIcon,
  HomeGlassIcon,
  ReservationsGlassIcon,
  TeamGlassIcon,
} from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

import { useInstanceConfig } from "@/components/instance-provider";

import {
  SETTINGS_NAVIGATION_GROUPS,
  type SettingsNavigationGroupId,
  type SettingsNavigationItem,
  filterSettingsNavigationItems,
} from "./settings-navigation.constants";
import { buildSettingsSearchHref } from "./util.settings-search-focus";
import {
  getMessageText,
  getSearchableMessageText,
  getSettingsSearchScore,
} from "./util.settings-search";

/**
 * One glass icon per category, not per entry: with some twenty settings pages,
 * an icon on every row made the list as loud as the content next to it. The
 * category icon is the landmark; the rows stay plain text.
 */
const GROUP_ICONS: Record<SettingsNavigationGroupId, typeof HomeGlassIcon> = {
  store: HomeGlassIcon,
  rental: ReservationsGlassIcon,
  communication: HelpGlassIcon,
  accountData: TeamGlassIcon,
};

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
  /** Louez's own billing bills this store now: its referral rewards are listed. */
  legacyBillingEnabled?: boolean;
  /** The viewer may see the billing pages of this store ("Facturation"). */
  billingPagesEnabled?: boolean;
  electronicInvoicingEnabled?: boolean;
  /** The settings page on screen, where it is not the one in the address bar: a demo scene. */
  pathname?: string;
  /** Replaces every navigation of the menu and its search. */
  onNavigate?: (href: string) => void;
};

export const SettingsNav = ({
  isPlatformAdmin = false,
  legacyBillingEnabled = false,
  billingPagesEnabled = false,
  electronicInvoicingEnabled = true,
  pathname: suppliedPathname,
  onNavigate,
}: SettingsNavProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const currentPathname = usePathname();
  const pathname = suppliedPathname ?? currentPathname;
  const router = useRouter();
  const go = onNavigate ?? ((href: string) => router.push(href));
  const messages = useMessages();
  const t = useTranslations("dashboard.settings.settingsNavigation");

  const { billingEnabled } = useInstanceConfig();
  const availableItems = useMemo(
    () =>
      filterSettingsNavigationItems({
        billingEnabled,
        legacyBillingEnabled,
        billingPagesEnabled,
        electronicInvoicingEnabled,
        isPlatformAdmin,
      }),
    [
      billingEnabled,
      legacyBillingEnabled,
      billingPagesEnabled,
      isPlatformAdmin,
      electronicInvoicingEnabled,
    ],
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
    go(href);
  };

  const navigateToSearchMatch = (item: IndexedSettingsNavigationItem) => {
    go(buildSettingsSearchHref({ href: item.href, itemId: item.id, query: searchQuery }));
    setSearchQuery("");
  };

  return (
    <aside className="min-w-0">
      <div className="lg:sticky lg:top-6">
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
              "bg-muted border-transparent shadow-none has-focus-visible:border-ring has-focus-visible:shadow-[0_0_0_4px_var(--color-accent)]! has-focus-visible:ring-0",
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
            <div className="mt-3 lg:hidden">
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

            <nav className="mt-5 hidden lg:block" aria-label={t("label")}>
              <div className="space-y-5">
                {navigationGroups.map(({ group, items }) => {
                  const GroupIcon = GROUP_ICONS[group];
                  const groupActive = items.some((item) => isActive(item.href));

                  return (
                    <section key={group} aria-labelledby={`settings-group-${group}`}>
                      <h2
                        id={`settings-group-${group}`}
                        /* The category holding the current page lights its
                           icon, like the main nav does for its rows. */
                        className={cn(
                          "text-foreground mb-1 flex items-center gap-2 px-2 text-[13px] font-bold",
                          groupActive
                            ? "[--nc-gradient-1-color-1:var(--nav-icon-lit-1)] [--nc-gradient-1-color-2:var(--nav-icon-lit-2)]"
                            : "[--nc-gradient-1-color-1:var(--nav-icon-rest-1)] [--nc-gradient-1-color-2:var(--nav-icon-rest-2)]",
                        )}
                      >
                        <GroupIcon size={22} uniqueId={`settings-group-icon-${group}`} />
                        {t(`groups.${group}`)}
                      </h2>
                      <div className="space-y-0.5">
                        {items.map((item) => {
                          const active = isActive(item.href);

                          return (
                            <Link
                              key={item.id}
                              href={item.href}
                              prefetch={onNavigate ? false : undefined}
                              onClick={
                                onNavigate
                                  ? (event) => {
                                      event.preventDefault();
                                      onNavigate(item.href);
                                    }
                                  : undefined
                              }
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "ease-lagon flex items-center rounded-[10px] py-2 pr-3 pl-10 text-sm transition-colors duration-150",
                                active
                                  ? "bg-accent text-primary font-bold"
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground font-medium",
                              )}
                            >
                              <span className="truncate">
                                {getMessageText(messages, item.labelPath)}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </nav>
          </>
        )}
      </div>
    </aside>
  );
};
