"use client";
import { createContext, useContext, useId, useState, type ComponentProps } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
import { ChevronDownIcon } from "@louez/ui/icons";
import { SidebarLink } from "@/components/dashboard/sidebar-link";
import { useHoverIntent } from "@/hooks/use-hover-intent";
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

/**
 * The nav is one flat, evenly spaced list. It used to be split into titled
 * sections ("Catalogue", "Gestion"), then into untitled runs with air between
 * them — but every row already names its page, so the grouping only added
 * height and an uneven rhythm. The order still follows the old sections.
 */
const buildNavigationItems = (
  aiCredits: { low: boolean; credits: number | null; hasUsedCredits: boolean } | null,
): NavigationItem[] => [
  ...mainNavigation,
  buildAiAssistantItem(aiCredits),
  ...catalogNavigation,
  // Purchase invoices (reception) are reachable from Settings → Facturation
  // électronique while e-invoicing adoption is low; add them back to the nav
  // once merchants actually live in that inbox.
  ...analyticsNavigation,
  ...managementNavigation,
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
  const hasSubItems = Boolean(item.items?.length);
  // A section shows its pages while you are inside it. Outside, they unfold
  // on a deliberate hover (see `useHoverIntent`) or with the chevron, which
  // pins the choice — the row itself still opens the section's first page.
  // A pinned choice is dropped when the section becomes (or stops being)
  // yours, so the tree follows the page.
  const [unfolded, setUnfolded] = useState<{ value: boolean; whenActive: boolean } | null>(null);
  const pinned = unfolded !== null && unfolded.whenActive === active ? unfolded.value : null;
  const hoverIntent = useHoverIntent(hasSubItems && !collapsedToRail && !active && pinned === null);
  const expanded = pinned ?? (active || hoverIntent.hovered);
  const subListId = useId();

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
    <SidebarMenuItem
      onPointerEnter={hoverIntent.onPointerEnter}
      onPointerLeave={hoverIntent.onPointerLeave}
    >
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
      {hasSubItems && (
        /* Says "this tab holds several pages" now that they no longer unfold
           on hover, and unfolds them on a click. It sits over the row's right
           edge like a menu action; the rail has the flyout instead. */
        <button
          type="button"
          /* Marks the row as carrying an action, which reserves its right edge
             so a long label truncates before the chevron. */
          data-sidebar="menu-action"
          aria-expanded={expanded}
          aria-controls={subListId}
          aria-label={tSidebar("sectionPages", { section: t(item.key) })}
          onClick={() => setUnfolded({ value: !expanded, whenActive: active })}
          className="text-sidebar-primary/70 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent focus-visible:ring-sidebar-ring ease-lagon absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md transition-colors duration-150 outline-hidden group-data-[collapsible=icon]:hidden focus-visible:ring-2"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "ease-lagon size-4 transition-transform duration-200 motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
      {item.alert && (
        /* The vertical offset has to be restated under the same
           `peer-data-[size]` variant as the default it replaces, otherwise the
           more specific default wins and the dot rides high on these `h-9`
           buttons. A section also carries its chevron at the right edge, so
           its dot steps left of it. */
        <SidebarMenuBadge
          className={cn(
            "bg-badge-warning-foreground peer-data-[size=default]/menu-button:top-3.5 size-2 min-w-0 rounded-full p-0",
            hasSubItems && "right-9",
          )}
        >
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
           are inside it, or once its chevron unfolds them. They no longer open
           on hover: the reveal pushed the rows below down under the pointer,
           which then had to chase the entry it was aiming at. `0fr`/`1fr` on a
           grid row is what makes an auto height animatable — the inner wrapper
           clips the overflow while it closes. */
        <div
          id={subListId}
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-lagon group-data-[collapsible=icon]:hidden motion-reduce:transition-none",
            expanded
              ? "grid-rows-[1fr]"
              : /* The mobile drawer keeps the entries open: it is a transient
                   sheet you open to see the whole map, and two extra rows cost
                   nothing there. */
                "grid-rows-[0fr] in-data-[mobile=true]:grid-rows-[1fr]",
          )}
        >
          {/* Folded, the entries stay out of the tab order: `inert` keeps
              keyboard focus from landing on links nobody can see. */}
          <div className="overflow-hidden" inert={!expanded || undefined}>
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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {buildNavigationItems(aiCredits).map((item) => (
                <DashboardNavItem key={item.href} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </NavigationContext>
  );
};
