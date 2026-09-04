"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import Gleap from "gleap";
import { useFormatter, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import { authClient } from "@louez/auth/client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Logo,
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Sidebar as UISidebar,
  useSidebar,
} from "@louez/ui";
import {
  AccentSparklesIcon,
  AdminShieldIcon,
  CrownIcon,
  LogoutIcon,
  OpenInNewIcon,
} from "@louez/ui/icons";
import {
  AiAssistantGlassIcon,
  AnalyticsGlassIcon,
  CustomersGlassIcon,
  HelpGlassIcon,
  HomeGlassIcon,
  ProductGlassIcon,
  ReservationsGlassIcon,
  SettingsGlassIcon,
  TeamGlassIcon,
} from "@louez/ui/icons/glass";

// import { ReferralSidebarWidget } from '@/components/dashboard/referral-sidebar-widget';
import { UserAvatar } from "@/components/dashboard/shared/user-avatar";
import { InstallPrompt } from "@/components/dashboard/install-prompt";
import { PushPrimer } from "@/components/dashboard/push-primer";
import { SidebarLink } from "@/components/dashboard/sidebar-link";
import { StoreSwitcher } from "@/components/dashboard/store-switcher";
import { ThemeMenuSub } from "@/components/dashboard/theme-toggle";
import { WhatsNewSidebarItem } from "@/components/dashboard/whats-new-sidebar-item";
import { LanguageMenuSub } from "@/components/ui/language-switcher";

import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import { aiCreditsQueries } from "@/lib/queries/ai-credits.queries";
import { cn } from "@/lib/utils";

interface StoreWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  onboardingCompleted: boolean;
  role: "owner" | "member" | "platform_admin";
}

interface DashboardSidebarProps {
  stores: StoreWithRole[];
  currentStoreId: string;
  storeSlug?: string;
  userId: string;
  userEmail: string;
  userImage?: string | null;
  planSlug?: string;
  isPlatformAdmin?: boolean;
  /**
   * null = paid AI credits disabled for this deployment: no wallet entry.
   * `credits` null = unlimited allowance (no count worth showing).
   * A zero count stays silent until the store has actually spent a credit.
   */
  aiCredits?: { low: boolean; credits: number | null; hasUsedCredits: boolean } | null;
  /** Public reeent listing of the store, null while it is not published there. */
  marketplaceListingUrl: string | null;
  /** The store signed up from the reeent consumer marketplace (ADR 010). */
  isFromReeent: boolean;
}

const mainNavigation = [
  { key: "home", href: "/dashboard", icon: HomeGlassIcon },
  { key: "reservations", href: "/dashboard/reservations", icon: ReservationsGlassIcon },
  { key: "customers", href: "/dashboard/customers", icon: CustomersGlassIcon },
];

/** What the assistant produces first, then what configures it. */
const aiAssistantSubItems = [
  { key: "aiConversations", href: "/dashboard/ai-assistant/conversations" },
  { key: "aiAdvisor", href: "/dashboard/ai-assistant/advisor" },
  { key: "aiVoice", href: "/dashboard/ai-assistant/voice" },
];

const catalogNavigation = [
  { key: "products", href: "/dashboard/products", icon: ProductGlassIcon },
];

// Money the store pays out, as opposed to the reservations it cashes in. The
const analyticsNavigation = [
  {
    key: "analytics",
    href: "/dashboard/analytics/sales",
    icon: AnalyticsGlassIcon,
    // The entry has no landing page of its own, so it lights up for the whole
    // section rather than for its own href.
    activeHref: "/dashboard/analytics",
    items: [
      { key: "analyticsSales", href: "/dashboard/analytics/sales" },
      { key: "analyticsTraffic", href: "/dashboard/analytics/traffic" },
    ],
  },
];

const managementNavigation = [
  { key: "team", href: "/dashboard/team", icon: TeamGlassIcon },
  { key: "settings", href: "/dashboard/settings", icon: SettingsGlassIcon },
];

interface NavigationSubItem {
  key: string;
  href: string;
  /** Discreet warning marker on the sub-row (currently: AI credits running out). */
  alert?: boolean;
  /** Numeric badge on the sub-row (currently: the AI credit balance). */
  badgeCount?: number;
}

interface NavigationItem {
  key: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Path the active state is derived from, when it is wider than `href`. */
  activeHref?: string;
  /** Sub-entries listed under the item (hidden while the sidebar is collapsed). */
  items?: NavigationSubItem[];
  /**
   * Draws the discreet warning marker. The AI credit balance now lives on a
   * sub-entry, so the parent only ever relays its alert — the rail hides
   * sub-entries and the expanded tree keeps them closed until you are in the
   * section, and the warning has to reach you either way.
   */
  alert?: boolean;
}

interface NavigationSection {
  labelKey?: string;
  items: NavigationItem[];
}

/**
 * The AI wallet only exists when the operator sells credits, so the assistant
 * section is assembled per render rather than declared once: without credits it
 * is three entries, with them the wallet joins as a fourth.
 */
const buildAiAssistantItem = (
  aiCredits: { low: boolean; credits: number | null; hasUsedCredits: boolean } | null,
): NavigationItem => {
  const alert = aiCredits !== null && aiCredits.hasUsedCredits && aiCredits.low;

  return {
    key: "aiAssistant",
    href: "/dashboard/ai-assistant",
    icon: AiAssistantGlassIcon,
    // The balance warning has to survive the wallet moving into a sub-entry:
    // the rail hides sub-entries, and the expanded tree only reveals them once
    // you are in the section, so the parent carries the marker.
    alert,
    items: aiCredits
      ? [
          ...aiAssistantSubItems,
          {
            key: "aiCredits",
            href: "/dashboard/ai-credits",
            alert,
            badgeCount:
              aiCredits.credits !== null && (aiCredits.credits > 0 || aiCredits.hasUsedCredits)
                ? aiCredits.credits
                : undefined,
          },
        ]
      : aiAssistantSubItems,
  };
};

const buildNavigationSections = (
  aiCredits: { low: boolean; credits: number | null; hasUsedCredits: boolean } | null,
): NavigationSection[] => [
  { items: [...mainNavigation, buildAiAssistantItem(aiCredits)] },
  { labelKey: "catalog", items: catalogNavigation },
  // Purchase invoices (reception) are reachable from Settings → Facturation
  // électronique while e-invoicing adoption is low; promote back to a sidebar
  // group once merchants actually live in that inbox.
  // No label: the group would only ever read "Analyses / Analyses", the entry
  // repeating the heading above it. The separator already opens the section.
  { items: analyticsNavigation },
  { labelKey: "manage", items: managementNavigation },
];

const isNavigationItemActive = (pathname: string, href: string) => {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};

/**
 * The parent's badge, shrunk to fit a sub-row: the AI wallet keeps showing its
 * balance (and its warning) now that it hangs under the assistant.
 */
const NavSubItemBadge = ({ alert, badgeCount }: { alert?: boolean; badgeCount?: number }) => {
  const t = useTranslations("dashboard.sidebar");
  const format = useFormatter();

  if (badgeCount == null && !alert) {
    return null;
  }

  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-full",
        badgeCount == null
          ? "bg-badge-warning-foreground size-2"
          : cn(
              "px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums",
              alert
                ? "bg-badge-warning-background text-badge-warning-foreground"
                : "bg-sidebar-accent text-sidebar-foreground/70",
            ),
      )}
    >
      {badgeCount != null &&
        format.number(Math.floor(badgeCount), {
          maximumFractionDigits: 0,
          useGrouping: false,
        })}
      {alert && <span className="sr-only">{t("aiCreditsLow")}</span>}
    </span>
  );
};

const DashboardNavItem = ({ item, pathname }: { item: NavigationItem; pathname: string }) => {
  const t = useTranslations("dashboard.navigation");
  const tSidebar = useTranslations("dashboard.sidebar");
  // A sub-entry can sit outside the parent's path (the AI wallet lives at
  // `/dashboard/ai-credits`), so the section counts as yours whenever any of
  // its rows is — otherwise the tree would close over the current page.
  const activeSub = item.items?.some((sub) => isNavigationItemActive(pathname, sub.href)) ?? false;
  const active = activeSub || isNavigationItemActive(pathname, item.activeHref ?? item.href);
  // Inside a section, the current page is one of the sub-entries — so the
  // parent drops the active card and keeps only the ink of an opened section.
  // Two stacked "selected" rows otherwise fight over which one you are on.
  // A section with no matching sub-entry keeps its card — otherwise nothing in
  // the sidebar would answer "where am I".
  const openSection = activeSub;
  const { state, isMobile } = useSidebar();
  // The mobile sheet is never "collapsed" — it just isn't a rail.
  const collapsedToRail = state === "collapsed" && !isMobile;

  const button = (
    <SidebarMenuButton
      render={<SidebarLink href={item.href} />}
      isActive={active && !openSection}
      /* A section swaps its tooltip for the flyout below, which names it and
         lists it in one surface — two hover popups on one icon would race. */
      tooltip={item.items?.length ? undefined : t(item.key)}
      className={cn(openSection && "text-sidebar-accent-foreground")}
    >
      <item.icon />
      <span>{t(item.key)}</span>
    </SidebarMenuButton>
  );

  return (
    <SidebarMenuItem>
      {item.items?.length && collapsedToRail ? (
        /* The rail hides the sub-entries, which would leave every page but the
           first one of a section unreachable. The flyout is the rail's version
           of the expanded tree: it names the section and lists it. */
        <PreviewCard>
          {/* A preview card waits ~600ms by default — right for a link
              preview, far too slow for a navigation rail. */}
          <PreviewCardTrigger delay={80} closeDelay={120} render={button} />
          <PreviewCardPopup side="right" align="start" sideOffset={8} className="w-48 p-1">
            <div className="flex w-full min-w-0 flex-col gap-1">
              <span className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                {t(item.key)}
              </span>
              {item.items.map((subItem) => (
                <SidebarLink
                  key={subItem.href}
                  href={subItem.href}
                  data-active={isNavigationItemActive(pathname, subItem.href) || undefined}
                  className="text-foreground/70 hover:bg-accent data-active:bg-accent data-active:text-foreground flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors data-active:font-medium"
                >
                  {t(subItem.key)}
                  <NavSubItemBadge alert={subItem.alert} badgeCount={subItem.badgeCount} />
                </SidebarLink>
              ))}
            </div>
          </PreviewCardPopup>
        </PreviewCard>
      ) : (
        button
      )}
      {item.alert && (
        /* The vertical offset has to be restated under the same
           `peer-data-[size]` variant as the default it replaces, otherwise the
           more specific default wins and the dot rides high on these `h-10`
           buttons. */
        <SidebarMenuBadge className="bg-badge-warning-foreground peer-data-[size=default]/menu-button:top-4 size-2 min-w-0 rounded-full p-0">
          <span className="sr-only">{tSidebar("aiCreditsLow")}</span>
        </SidebarMenuBadge>
      )}
      {item.alert && (
        /* Collapsed sidebar: the badge is hidden by its own styles, so the
           icon carries a bare dot instead. */
        <span
          aria-hidden
          className="bg-badge-warning-foreground ring-sidebar absolute top-1 right-1.5 hidden size-2.5 rounded-full ring-2 group-data-[collapsible=icon]:block"
        />
      )}
      {item.items && (
        /* Sub-entries are noise until the section is yours: they show once you
           are inside it, and on hover before that, so the section still
           advertises what it holds. `0fr`/`1fr` on a grid row is what makes an
           auto height animatable — the inner wrapper clips the overflow while
           the row closes. The hover group is the whole menu item, so moving the
           pointer down onto the revealed entries keeps them open. */
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[collapsible=icon]:hidden motion-reduce:transition-none",
            active
              ? "grid-rows-[1fr]"
              : /* Tailwind gates `hover:` behind `@media (hover: hover)`, so on
                   touch the reveal never fires — the mobile drawer keeps the
                   entries open. It is a transient sheet you open to see the
                   whole map, and two extra rows cost nothing there. */
                "grid-rows-[0fr] group-focus-within/menu-item:grid-rows-[1fr] group-hover/menu-item:grid-rows-[1fr] in-data-[mobile=true]:grid-rows-[1fr]",
          )}
        >
          <div className="overflow-hidden">
            {/* The guide line is pulled under the centre of the parent icon (8px
                of button padding + half a 20px icon) so the sub-entries hang off
                it, and their labels land on the parent label's baseline column. */}
            <SidebarMenuSub className="mx-0 mt-0.5 ml-4.5 gap-1 py-1 pr-0 pl-2">
              {item.items.map((subItem) => {
                const subActive = isNavigationItemActive(pathname, subItem.href);

                return (
                  <SidebarMenuSubItem
                    key={subItem.href}
                    /* Lights the stretch of guide line next to the current page
                       — the tree equivalent of the card, drawn on the line. */
                    className={cn(
                      "before:bg-sidebar-primary before:absolute before:top-1 before:bottom-1 before:-left-2.25 before:w-0.5 before:rounded-full before:opacity-0 before:transition-opacity before:duration-200 before:content-['']",
                      subActive && "before:opacity-100",
                    )}
                  >
                    <SidebarMenuSubButton
                      render={<SidebarLink href={subItem.href} />}
                      isActive={subActive}
                      /* A smaller copy of the top-level active row rather than
                         the grey pill, which read heavier than the parent it
                         sits under and inverted the hierarchy. */
                      className="text-sidebar-foreground/70 hover:bg-sidebar-accent/70 data-active:bg-background data-active:text-sidebar-accent-foreground h-8 transition-colors data-[size=md]:text-[13px] data-active:font-medium data-active:shadow-[0_0_0_1px_var(--color-border)]"
                    >
                      <span>{t(subItem.key)}</span>
                      <NavSubItemBadge alert={subItem.alert} badgeCount={subItem.badgeCount} />
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              })}
            </SidebarMenuSub>
          </div>
        </div>
      )}
    </SidebarMenuItem>
  );
};

const DashboardNavSection = ({
  items,
  labelKey,
  pathname,
}: {
  items: NavigationItem[];
  labelKey?: string;
  pathname: string;
}) => {
  const t = useTranslations("dashboard.sidebar");

  return (
    <SidebarGroup>
      {labelKey && <SidebarGroupLabel>{t(labelKey)}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <DashboardNavItem key={item.href} item={item} pathname={pathname} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

/**
 * Shared by the plain storefront link and the menu trigger so the header keeps
 * the exact same shape whichever public page a store gets.
 */
const HEADER_ACTION_CLASS_NAME =
  "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-md transition-colors group-data-[collapsible=icon]:hidden";

const StoreHeader = ({
  stores,
  currentStoreId,
  storeSlug,
  planSlug,
  marketplaceListingUrl,
  isFromReeent,
}: {
  stores: StoreWithRole[];
  currentStoreId: string;
  storeSlug?: string;
  planSlug?: string;
  marketplaceListingUrl: string | null;
  isFromReeent: boolean;
}) => {
  const t = useTranslations("dashboard.sidebar");
  const { getAbsoluteUrl } = useStorefrontUrl(storeSlug ?? "");

  return (
    <SidebarHeader className="border-sidebar-border gap-3 border-b px-0 max-md:px-2">
      <div className="flex min-w-0 items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col group-data-[state=expanded]:pl-4 max-md:pl-2">
        <div className="flex items-center gap-2">
          <SidebarLink href="/dashboard" className="flex min-w-0 items-center gap-2">
            <Logo className="h-5 w-auto shrink-0 group-data-[collapsible=icon]:hidden" />
            <Image
              src={"/icons/maskable-512.png"}
              width={32}
              height={32}
              alt="Logo"
              className="hidden size-8 shrink-0 group-data-[collapsible=icon]:block rounded-md"
            />
          </SidebarLink>
          <PlanBadge planSlug={planSlug} />
        </div>

        {/* A store that came from reeent has no Louez storefront to promote:
            the marketplace listing is its public page, and there is nothing to
            link to until that listing goes live. */}
        {isFromReeent ? (
          marketplaceListingUrl && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarLink
                    href={marketplaceListingUrl}
                    target="_blank"
                    className={HEADER_ACTION_CLASS_NAME}
                  />
                }
              >
                <OpenInNewIcon className="h-4 w-4" />
                <span className="sr-only">{t("viewOnReeent")}</span>
              </TooltipTrigger>
              <TooltipContent side="right">{t("viewOnReeent")}</TooltipContent>
            </Tooltip>
          )
        ) : storeSlug ? (
          marketplaceListingUrl ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={<DropdownMenuTrigger className={HEADER_ACTION_CLASS_NAME} />}
                >
                  <OpenInNewIcon className="h-4 w-4" />
                  <span className="sr-only">{t("viewStore")}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{t("viewStore")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem render={<SidebarLink href={getAbsoluteUrl()} target="_blank" />}>
                  {t("openStorefront")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<SidebarLink href={marketplaceListingUrl} target="_blank" />}
                >
                  {t("openReeentListing")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarLink
                    href={getAbsoluteUrl()}
                    target="_blank"
                    className={HEADER_ACTION_CLASS_NAME}
                  />
                }
              >
                <OpenInNewIcon className="h-4 w-4" />
                <span className="sr-only">{t("viewStore")}</span>
              </TooltipTrigger>
              <TooltipContent side="right">{t("viewStore")}</TooltipContent>
            </Tooltip>
          )
        ) : null}
      </div>
      <div className="mx-auto w-fit group-data-[state=expanded]:w-full max-md:w-full">
        <StoreSwitcher stores={stores} currentStoreId={currentStoreId} />
      </div>
    </SidebarHeader>
  );
};

const UserMenu = ({
  userId,
  userEmail,
  userImage,
  isPlatformAdmin,
}: {
  userId: string;
  userEmail: string;
  userImage?: string | null;
  isPlatformAdmin?: boolean;
}) => {
  const t = useTranslations("dashboard.settings.accountSettings");
  const tAuth = useTranslations("auth");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="hover:bg-background aria-expanded:bg-background aria-expanded:shadow-[0_0_1px_0px_var(--color-border)] min-w-0 *:w-full h-12 w-full justify-start gap-3 px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:px-0"
          />
        }
      >
        <UserAvatar src={userImage} seed={userId} size={32} />
        <span className="truncate min-w-0 text-left text-sm font-medium group-data-[collapsible=icon]:hidden">
          {userEmail}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <ThemeMenuSub />
        <LanguageMenuSub />
        <DropdownMenuItem render={<SidebarLink href="/dashboard/account" />}>
          {t("title")}
        </DropdownMenuItem>
        {isPlatformAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<SidebarLink href="/admin" />}>
              <AdminShieldIcon className="mr-2 h-4 w-4" />
              {t("administration")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = "/login";
                },
              },
            })
          }
          className="text-destructive cursor-pointer"
        >
          <LogoutIcon className="mr-2 h-4 w-4" />
          {tAuth("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Opens the Gleap widget — a button, not a route, but it reads as a nav row. */
const HelpButton = () => {
  const t = useTranslations("dashboard.sidebar");

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={() => Gleap.open()} tooltip={t("help")}>
        <HelpGlassIcon />
        <span>{t("help")}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

export const DashboardSidebar = ({
  stores,
  currentStoreId,
  storeSlug,
  userId,
  userEmail,
  userImage,
  planSlug,
  isPlatformAdmin,
  aiCredits = null,
  marketplaceListingUrl,
  isFromReeent,
}: DashboardSidebarProps) => {
  const pathname = usePathname();
  const balanceQuery = useQuery({
    ...aiCreditsQueries.balance(),
    enabled: aiCredits !== null,
  });
  const liveAiCredits = balanceQuery.data
    ? balanceQuery.data.enabled
      ? {
          low: balanceQuery.data.low,
          credits: balanceQuery.data.totalCredits,
          hasUsedCredits: balanceQuery.data.hasUsedCredits,
        }
      : null
    : aiCredits;
  const navigationSections = buildNavigationSections(liveAiCredits);

  return (
    <TooltipProvider>
      <UISidebar variant="inset" collapsible="icon">
        <StoreHeader
          stores={stores}
          currentStoreId={currentStoreId}
          storeSlug={storeSlug}
          planSlug={planSlug}
          marketplaceListingUrl={marketplaceListingUrl}
          isFromReeent={isFromReeent}
        />

        <SidebarContent className="max-md:px-2 ">
          {navigationSections.map((section, index) => (
            <div key={section.labelKey ?? `section-${index}`} className="w-full">
              {index > 0 && <SidebarSeparator />}
              <DashboardNavSection
                items={section.items}
                labelKey={section.labelKey}
                pathname={pathname}
              />
            </div>
          ))}
        </SidebarContent>
        <SidebarFooter className="border-sidebar-border border-t">
          <SidebarMenu>
            {/* Nudges sit in the same menu as the utilities they resemble —
                they only differ by the attention dot they carry. */}
            <InstallPrompt />
            <PushPrimer />
            <WhatsNewSidebarItem />
            <HelpButton />
          </SidebarMenu>
          {/* <ReferralSidebarWidget /> */}
          <UserMenu
            userId={userId}
            userEmail={userEmail}
            userImage={userImage}
            isPlatformAdmin={isPlatformAdmin}
          />
        </SidebarFooter>
        {/* <SidebarRail /> */}
      </UISidebar>
    </TooltipProvider>
  );
};

function PlanBadge({ planSlug }: { planSlug?: string }) {
  const plan = planSlug || "pay_as_you_go";

  const planConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    pro: {
      label: "Pro",
      className: "bg-primary/10 text-primary hover:bg-primary/20",
      icon: <AccentSparklesIcon className="h-3 w-3" />,
    },
    ultra: {
      label: "Ultra",
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20",
      icon: <CrownIcon className="h-3 w-3" />,
    },
  };

  // Pay-as-you-go (the default) shows no plan badge next to the logo — only the
  // paid tiers get a badge.
  const config = planConfig[plan];
  if (!config) return null;

  return (
    <Link
      href="/dashboard/settings/subscription"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors group-data-[collapsible=icon]:hidden",
        config.className,
      )}
    >
      {config.icon}
      {config.label}
    </Link>
  );
}
