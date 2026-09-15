"use client";
import { createContext, useContext, type ComponentProps } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "@louez/ui";
import {
  AiAssistantGlassIcon,
  AnalyticsGlassIcon,
  CustomersGlassIcon,
  HomeGlassIcon,
  ProductGlassIcon,
  ReservationsGlassIcon,
  SettingsGlassIcon,
  TeamGlassIcon,
} from "@louez/ui/icons/glass";
import { SidebarLink } from "@/components/dashboard/sidebar-link";
import { cn } from "@/lib/utils";

type LocalNavigation = {
  href: string;
  availableHrefs?: string[];
  onNavigate: (href: string) => void;
};
const NavigationContext = createContext<LocalNavigation | undefined>(undefined);
function NavigationLink({ href, onClick, ...props }: ComponentProps<typeof SidebarLink>) {
  const local = useContext(NavigationContext);
  const unavailable = local?.availableHrefs && !local.availableHrefs.includes(String(href));
  return (
    <SidebarLink
      {...props}
      aria-disabled={unavailable || undefined}
      tabIndex={unavailable ? -1 : undefined}
      href={local?.href ?? href}
      prefetch={local ? false : undefined}
      data-navigation-href={String(href)}
      onClick={(event) => {
        onClick?.(event);
        if (local && !event.defaultPrevented) {
          event.preventDefault();
          if (!unavailable) local.onNavigate(String(href));
        }
      }}
    />
  );
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
  // No label: the one row already names the section.
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
      render={<NavigationLink href={item.href} />}
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
                <NavigationLink
                  key={subItem.href}
                  href={subItem.href}
                  data-active={isNavigationItemActive(pathname, subItem.href) || undefined}
                  className="text-foreground/70 hover:bg-accent data-active:bg-accent data-active:text-foreground flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors data-active:font-medium"
                >
                  {t(subItem.key)}
                  <NavSubItemBadge alert={subItem.alert} badgeCount={subItem.badgeCount} />
                </NavigationLink>
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
                      render={<NavigationLink href={subItem.href} />}
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

export const DashboardNavigation = ({
  pathname,
  aiCredits = null,
  localNavigation,
}: {
  pathname: string;
  aiCredits?: { low: boolean; credits: number | null; hasUsedCredits: boolean } | null;
  localNavigation?: LocalNavigation;
}) => {
  return (
    <NavigationContext value={localNavigation}>
      <SidebarContent className="max-md:px-2 ">
        {buildNavigationSections(aiCredits).map((section, index) => (
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
    </NavigationContext>
  );
};
