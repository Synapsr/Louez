"use client";

import { Fragment, useMemo, useState } from "react";
import type { ComponentType } from "react";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useMessages, useTranslations } from "next-intl";

import {
  Button,
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTrigger,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
  DialogTitle,
} from "@louez/ui";
import {
  AnalyticsIcon,
  BotIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChatIcon,
  ExternalLinkIcon,
  HomeIcon,
  PackageIcon,
  PhoneCallIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
} from "@louez/ui/icons";

import { cn, formatCurrency } from "@louez/utils";

import { useStore } from "@/contexts/store-context";
import { useDebounce } from "@/hooks/use-debounce";
import {
  useTrackedKeyboardHotkey,
  useTrackedKeyboardShortcutSequence,
} from "@/hooks/use-tracked-keyboard-shortcut";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import { useWhatsNew } from "@/hooks/use-whats-new";
import { searchQueries } from "@/lib/queries/search.queries";

import { NewFeatureBadge } from "../new-feature-badge";
import {
  SETTINGS_NAVIGATION_GROUPS,
  SETTINGS_NAVIGATION_ITEMS,
} from "../settings-navigation.constants";
import { buildSettingsSearchHref } from "../util.settings-search-focus";
import {
  getMessageText,
  getSearchableMessageText,
  getSettingsSearchScore,
  normalizeSettingsSearchText,
} from "../util.settings-search";
import { ChatModal } from "./chat-modal";

type CommandActionBase = {
  description?: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string;
  label: string;
  shortcut?: string;
  value: string;
};

type CommandAction =
  | (CommandActionBase & { href: string; kind: "navigate" })
  | (CommandActionBase & { href: string; kind: "external" })
  | (CommandActionBase & { kind: "createReservation" })
  | (CommandActionBase & { kind: "ai" })
  | (CommandActionBase & {
      description: string;
      href: string;
      itemId: string;
      kind: "settingsSearch";
    });

type CommandGroupDefinition = {
  items: CommandAction[];
  value: string;
};

/** Announcement backing the contextual "New" dot on the palette triggers. */
const SEARCH_FEATURE_ID = "navigation-refresh";

type DashboardCommandPaletteProps = {
  isPlatformAdmin?: boolean;
  electronicInvoicingEnabled?: boolean;
  onCreateReservation: () => void;
  showAIChat: boolean;
};

export const DashboardCommandPalette = ({
  isPlatformAdmin = false,
  electronicInvoicingEnabled = true,
  onCreateReservation,
  showAIChat,
}: DashboardCommandPaletteProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [aiChatOpen, setAIChatOpen] = useState(false);
  const router = useRouter();
  const t = useTranslations("dashboard");
  const tSettingsNavigation = useTranslations("dashboard.settings.settingsNavigation");
  const messages = useMessages();
  const formatter = useFormatter();
  const { storeSlug, currency } = useStore();
  const { getAbsoluteUrl } = useStorefrontUrl(storeSlug);
  const { dismissFeature } = useWhatsNew();

  const commandPaletteShortcut = useTrackedKeyboardHotkey(
    "commandPalette",
    () => {
      setQuery("");
      dismissFeature(SEARCH_FEATURE_ID);
      setOpen((currentOpen) => !currentOpen);
    },
    { requireReset: true },
  );

  const createReservationShortcut = useTrackedKeyboardShortcutSequence(
    "createReservation",
    () => {
      setOpen(false);
      onCreateReservation();
    },
    {
      meta: {
        name: t("shortcuts.actions.createReservation"),
      },
    },
  );

  const goToReservationsShortcut = useTrackedKeyboardShortcutSequence(
    "goToReservations",
    () => {
      setOpen(false);
      router.push("/dashboard/reservations");
    },
    {
      meta: {
        name: t("shortcuts.actions.goToReservations"),
      },
    },
  );

  const goToCalendarShortcut = useTrackedKeyboardShortcutSequence(
    "goToCalendar",
    () => {
      setOpen(false);
      router.push("/dashboard/reservations?view=calendar");
    },
    {
      meta: {
        name: t("shortcuts.actions.goToCalendar"),
      },
    },
  );

  const aiAssistantShortcut = useTrackedKeyboardHotkey(
    "aiAssistant",
    () => {
      setOpen(false);
      setAIChatOpen(true);
    },
    { enabled: showAIChat, requireReset: true },
  );

  const toolActions: CommandAction[] = [
    {
      value: "view-storefront",
      label: t("sidebar.viewStore"),
      keywords: "boutique vitrine storefront store site public preview",
      icon: ExternalLinkIcon,
      kind: "external",
      href: getAbsoluteUrl(),
    },
  ];

  if (showAIChat) {
    toolActions.push({
      value: "open-ai-assistant",
      label: t("aiChat.open"),
      keywords: "ia ai assistant demander question aide help",
      icon: SparklesIcon,
      kind: "ai",
      shortcut: aiAssistantShortcut.label,
    });
  }

  const settingsSearchDocuments = useMemo(
    () =>
      SETTINGS_NAVIGATION_ITEMS.filter(
        (item) =>
          (!item.platformAdminOnly || isPlatformAdmin) &&
          (!item.requiresElectronicInvoicing || electronicInvoicingEnabled),
      ).map(
        (item) => ({
          ...item,
          content: getSearchableMessageText(messages, item.searchPaths),
          description: getMessageText(messages, item.descriptionPath),
          label: getMessageText(messages, item.labelPath),
        }),
      ),
    [isPlatformAdmin, electronicInvoicingEnabled, messages],
  );

  const trimmedQuery = query.trim();

  const settingsGroups: CommandGroupDefinition[] = useMemo(() => {
    if (!trimmedQuery) {
      return [];
    }

    const matches = settingsSearchDocuments
      .map((item) => {
        const score = getSettingsSearchScore({ ...item, query: trimmedQuery });

        return score === null ? null : { ...item, score };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((left, right) => left.score - right.score);

    return SETTINGS_NAVIGATION_GROUPS.map((group) => ({
      value: `${t("navigation.settings")} · ${tSettingsNavigation(`groups.${group}`)}`,
      items: matches
        .filter((item) => item.group === group)
        .map(
          (item): CommandAction => ({
            value: `settings-${item.id}`,
            label: item.label,
            description: item.description,
            keywords: "",
            icon: item.icon,
            kind: "settingsSearch",
            href: item.href,
            itemId: item.id,
          }),
        ),
    })).filter((group) => group.items.length > 0);
  }, [settingsSearchDocuments, t, tSettingsNavigation, trimmedQuery]);

  const debouncedQuery = useDebounce(trimmedQuery, 200);
  const entitySearchEnabled = open && debouncedQuery.length >= 2;

  const { data: entityResults } = useQuery({
    ...searchQueries.global(debouncedQuery),
    enabled: entitySearchEnabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const entityGroups: CommandGroupDefinition[] = [];

  if (trimmedQuery.length >= 2 && entityResults) {
    if (entityResults.products.length > 0) {
      entityGroups.push({
        value: t("navigation.products"),
        items: entityResults.products.map(
          (product): CommandAction => ({
            value: `product-${product.id}`,
            label: product.name,
            description: formatCurrency(Number(product.price), currency),
            keywords: "",
            icon: PackageIcon,
            kind: "navigate",
            href: `/dashboard/products/${product.id}`,
          }),
        ),
      });
    }

    if (entityResults.reservations.length > 0) {
      entityGroups.push({
        value: t("navigation.reservations"),
        items: entityResults.reservations.map(
          (reservation): CommandAction => ({
            value: `reservation-${reservation.id}`,
            label: `#${reservation.number} · ${reservation.customerName}`,
            description: formatter.dateTimeRange(
              new Date(reservation.startDate),
              new Date(reservation.endDate),
              { day: "numeric", month: "short", year: "numeric" },
            ),
            keywords: "",
            icon: CalendarIcon,
            kind: "navigate",
            href: `/dashboard/reservations/${reservation.id}`,
          }),
        ),
      });
    }

    if (entityResults.customers.length > 0) {
      entityGroups.push({
        value: t("navigation.customers"),
        items: entityResults.customers.map(
          (customer): CommandAction => ({
            value: `customer-${customer.id}`,
            label: customer.name,
            description: customer.email,
            keywords: "",
            icon: UsersIcon,
            kind: "navigate",
            href: `/dashboard/customers/${customer.id}`,
          }),
        ),
      });
    }
  }

  const commandGroups = [
    {
      value: t("commandPalette.groups.create"),
      items: [
        {
          value: "new-reservation",
          label: t("sidebar.newReservation"),
          keywords: "reservation booking location commande creer ajouter new create",
          icon: CalendarIcon,
          kind: "createReservation",
          shortcut: createReservationShortcut.label,
        },
        {
          value: "new-product",
          label: t("products.addProduct"),
          keywords:
            "produit article materiel catalogue product item equipment creer ajouter new create",
          icon: PackageIcon,
          kind: "navigate",
          href: "/dashboard/products/new",
        },
        {
          value: "new-customer",
          label: t("customers.addCustomer"),
          keywords: "client locataire contact customer renter creer ajouter new create",
          icon: UsersIcon,
          kind: "navigate",
          href: "/dashboard/customers/new",
        },
      ],
    },
    {
      value: t("commandPalette.groups.navigate"),
      items: [
        {
          value: "dashboard",
          label: t("navigation.home"),
          keywords: "accueil home dashboard tableau de bord",
          icon: HomeIcon,
          kind: "navigate",
          href: "/dashboard",
        },
        {
          value: "calendar",
          label: t("navigation.calendar"),
          keywords: "calendrier planning agenda schedule disponibilites",
          icon: CalendarDaysIcon,
          kind: "navigate",
          href: "/dashboard/reservations?view=calendar",
          shortcut: goToCalendarShortcut.label,
        },
        {
          value: "reservations",
          label: t("navigation.reservations"),
          keywords: "reservations bookings locations commandes rentals",
          icon: CalendarIcon,
          kind: "navigate",
          href: "/dashboard/reservations",
          shortcut: goToReservationsShortcut.label,
        },
        {
          value: "products",
          label: t("navigation.products"),
          keywords: "produits articles materiel catalogue products items",
          icon: PackageIcon,
          kind: "navigate",
          href: "/dashboard/products",
        },
        {
          value: "customers",
          label: t("navigation.customers"),
          keywords: "clients locataires contacts customers renters",
          icon: UsersIcon,
          kind: "navigate",
          href: "/dashboard/customers",
        },
        {
          value: "analytics",
          label: t("navigation.analytics"),
          keywords:
            "analyses statistiques performance chiffre affaires revenus analytics statistics revenue",
          icon: AnalyticsIcon,
          kind: "navigate",
          href: "/dashboard/analytics/sales",
        },
        {
          value: "analytics-traffic",
          label: t("navigation.analyticsTraffic"),
          keywords: "trafic visiteurs vues conversions audience traffic visitors views conversions",
          icon: AnalyticsIcon,
          kind: "navigate",
          href: "/dashboard/analytics/traffic",
        },
        {
          value: "ai-conversations",
          label: t("navigation.aiConversations"),
          keywords:
            "conversations discussions echanges clients conseiller appels transcriptions chats customer calls transcripts",
          icon: ChatIcon,
          kind: "navigate",
          href: "/dashboard/ai-assistant/conversations",
        },
        {
          value: "ai-advisor",
          label: t("navigation.aiAdvisor"),
          keywords: "conseiller advisor ia ai vitrine widget chatbot configuration",
          icon: BotIcon,
          kind: "navigate",
          href: "/dashboard/ai-assistant/advisor",
        },
        {
          value: "ai-voice",
          label: t("navigation.aiVoice"),
          keywords: "agent vocal voix telephone appels numero voice phone calls number",
          icon: PhoneCallIcon,
          kind: "navigate",
          href: "/dashboard/ai-assistant/voice",
        },
        {
          value: "settings",
          label: t("navigation.settings"),
          keywords: "parametres reglages configuration settings preferences",
          icon: SettingsIcon,
          kind: "navigate",
          href: "/dashboard/settings",
        },
      ],
    },
    {
      value: t("commandPalette.groups.tools"),
      items: toolActions,
    },
  ] satisfies CommandGroupDefinition[];

  const queryTokens = normalizeSettingsSearchText(trimmedQuery).split(/\s+/).filter(Boolean);

  const matchesQuery = (action: CommandAction) => {
    const searchableText = normalizeSettingsSearchText(`${action.label} ${action.keywords}`);

    return queryTokens.every((token) => searchableText.includes(token));
  };

  const visibleGroups: CommandGroupDefinition[] = [
    ...commandGroups
      .map((group) => ({
        ...group,
        items: queryTokens.length > 0 ? group.items.filter(matchesQuery) : group.items,
      }))
      .filter((group) => group.items.length > 0),
    ...entityGroups,
    ...settingsGroups,
  ];

  const runAction = (action: CommandAction) => {
    setOpen(false);

    if (action.kind === "settingsSearch") {
      router.push(
        buildSettingsSearchHref({ href: action.href, itemId: action.itemId, query: trimmedQuery }),
      );
      return;
    }

    if (action.kind === "navigate") {
      router.push(action.href);
      return;
    }

    if (action.kind === "external") {
      window.open(action.href, "_blank", "noopener,noreferrer");
      return;
    }

    if (action.kind === "createReservation") {
      onCreateReservation();
      return;
    }

    setAIChatOpen(true);
  };

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);

          if (nextOpen) {
            setQuery("");
            dismissFeature(SEARCH_FEATURE_ID);
          }
        }}
      >
        <CommandDialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="bg-background/70 text-muted-foreground hidden h-9 min-w-48 justify-start gap-2 hover:bg-background hover:text-foreground lg:flex"
            />
          }
        >
          <Search className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">{t("commandPalette.trigger")}</span>
          <kbd className="bg-muted text-muted-foreground/70 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium">
            {commandPaletteShortcut.label}
          </kbd>
          {/* Corner dot: the trigger already carries a label and the shortcut hint. */}
          <NewFeatureBadge
            className="absolute -top-1 -right-1"
            featureId={SEARCH_FEATURE_ID}
            mode="dot"
          />
        </CommandDialogTrigger>

        <CommandDialogTrigger
          aria-label={t("commandPalette.title")}
          render={<Button type="button" variant="outline" size="icon" className="lg:hidden" />}
        >
          <Search className="size-4" />
          <NewFeatureBadge
            className="absolute -top-1 -right-1"
            featureId={SEARCH_FEATURE_ID}
            mode="dot"
          />
        </CommandDialogTrigger>

        <CommandDialogPopup>
          <DialogTitle className="sr-only">{t("commandPalette.title")}</DialogTitle>
          <Command
            filter={null}
            items={visibleGroups}
            value={query}
            onValueChange={setQuery}
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
              aria-label={t("commandPalette.title")}
              placeholder={t("commandPalette.placeholder")}
            />
            <CommandPanel>
              <CommandEmpty>{t("commandPalette.empty")}</CommandEmpty>
              <CommandList>
                {(group: CommandGroupDefinition, groupIndex: number) => (
                  <Fragment key={group.value}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.value}</CommandGroupLabel>
                      <CommandCollection>
                        {(action: CommandAction) => (
                          <CommandItem
                            key={action.value}
                            value={action}
                            onClick={() => runAction(action)}
                            className={cn("gap-2.5 py-2", action.description && "items-start")}
                          >
                            <action.icon
                              className={cn(
                                "text-muted-foreground size-4 shrink-0",
                                action.description && "mt-0.5",
                              )}
                            />
                            {action.description ? (
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{action.label}</span>
                                <span className="text-muted-foreground line-clamp-2 block text-xs">
                                  {action.description}
                                </span>
                              </span>
                            ) : (
                              <span className="min-w-0 flex-1 truncate">{action.label}</span>
                            )}
                            {action.shortcut && (
                              <CommandShortcut>{action.shortcut}</CommandShortcut>
                            )}
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </CommandGroup>
                    {groupIndex < visibleGroups.length - 1 && <CommandSeparator />}
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
            <CommandFooter className="hidden sm:flex">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    <kbd className="bg-muted rounded border p-0.5">
                      <ArrowUp className="size-3" />
                    </kbd>
                    <kbd className="bg-muted rounded border p-0.5">
                      <ArrowDown className="size-3" />
                    </kbd>
                  </span>
                  <span>{t("commandPalette.footer.navigate")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <kbd className="bg-muted rounded border p-0.5">
                    <CornerDownLeft className="size-3" />
                  </kbd>
                  <span>{t("commandPalette.footer.open")}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
                  Esc
                </kbd>
                <span>{t("commandPalette.footer.close")}</span>
              </div>
            </CommandFooter>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>

      {showAIChat && <ChatModal open={aiChatOpen} onOpenChange={setAIChatOpen} />}
    </>
  );
};
