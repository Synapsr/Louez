"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import Gleap from "gleap";
import { useTranslations } from "next-intl";
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
  LogoIcon,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Sidebar as UISidebar,
} from "@louez/ui";
import {
  AccentSparklesIcon,
  AdminShieldIcon,
  CrownIcon,
  LogoutIcon,
  OpenInNewIcon,
} from "@louez/ui/icons";
import { HelpGlassIcon } from "@louez/ui/icons/glass";

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
import { DashboardNavigation } from "./dashboard-navigation";

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
            <LogoIcon className="hidden size-8 shrink-0 group-data-[collapsible=icon]:block" />
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

        <DashboardNavigation pathname={pathname} aiCredits={liveAiCredits} />
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
