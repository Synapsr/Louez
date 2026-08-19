"use client";

import { useMemo, useState, useTransition } from "react";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

import { useTranslations } from "next-intl";

import {
  Button,
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@louez/ui";
import {
  AdminShieldIcon,
  BuildingIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
} from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { switchStore } from "@/app/(dashboard)/dashboard/actions";
import { useInstanceConfig } from "@/components/instance-provider";

function StoreLogo({
  logoUrl,
  name,
  size = "md",
}: {
  logoUrl: string | null;
  name: string;
  size?: "sm" | "md";
}) {
  const dimensions = size === "sm" ? "size-6" : "size-8";
  const textSize = size === "sm" ? "text-[10px]" : "text-sm";

  if (logoUrl) {
    return (
      <div className={cn("relative shrink-0 overflow-hidden rounded-md", dimensions)}>
        <Image
          src={logoUrl}
          alt={name}
          fill
          className="object-contain object-left"
          sizes={size === "sm" ? "40px" : "48px"}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-primary/10 text-primary flex shrink-0 items-center justify-center rounded-md font-medium",
        size === "sm" ? "size-6" : "size-8",
        textSize,
      )}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

interface StoreWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  onboardingCompleted: boolean;
  role: "owner" | "member" | "platform_admin";
}

interface StoreSwitcherProps {
  stores: StoreWithRole[];
  currentStoreId: string;
}

function getStoreSwitchDestination(pathname: string, onboardingCompleted: boolean): string {
  if (!onboardingCompleted) {
    return "/onboarding";
  }

  const pathSegments = pathname.split("/").filter(Boolean);

  if (pathSegments[0] === "onboarding") {
    return "/dashboard";
  }

  if (pathSegments[0] !== "dashboard") {
    return "/dashboard";
  }

  const dashboardSection = pathSegments[1];
  return dashboardSection ? `/dashboard/${dashboardSection}` : "/dashboard";
}

function RoleBadge({
  role,
  t,
}: {
  role: StoreWithRole["role"];
  t: ReturnType<typeof useTranslations<"dashboard.storeSwitcher">>;
}) {
  if (role === "platform_admin") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
        <AdminShieldIcon className="h-3 w-3" />
        {t("roles.platform_admin")}
      </span>
    );
  }

  return <span className="text-muted-foreground text-xs capitalize">{t(`roles.${role}`)}</span>;
}

export function StoreSwitcher({ stores, currentStoreId }: StoreSwitcherProps) {
  const t = useTranslations("dashboard.storeSwitcher");
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const currentStore = stores.find((s) => s.id === currentStoreId);

  const filteredStores = useMemo(() => {
    if (!searchQuery) return stores;
    const query = searchQuery.toLowerCase();
    return stores.filter((store) => store.name.toLowerCase().includes(query));
  }, [stores, searchQuery]);

  const handleStoreSelect = (storeId: string) => {
    if (storeId === currentStoreId) {
      setOpen(false);
      return;
    }

    const selectedStore = stores.find((store) => store.id === storeId);
    if (!selectedStore) return;

    startTransition(async () => {
      const result = await switchStore(storeId);
      if (result.success) {
        const nextPath = getStoreSwitchDestination(pathname, selectedStore.onboardingCompleted);
        setOpen(false);

        // Force a full navigation so TanStack Query cache from previous store
        // does not leak into the next store context on same-route switches.
        window.location.assign(nextPath);
      }
    });
  };

  const handleCreateStore = () => {
    setOpen(false);
    router.push("/onboarding?new=true");
  };

  const handleMultiStoreView = () => {
    setOpen(false);
    router.push("/multi-store");
  };

  // Standalone instances host a single store: creating another one and the
  // multi-store view are platform features and disappear from the menu.
  const { standalone } = useInstanceConfig();
  const showMultiStore = !standalone && stores.length >= 2;
  const showCreateStore = !standalone;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearchQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            aria-label={t("selectStore")}
            className={cn(
              "h-auto w-full [&>span]:w-full justify-between px-3 py-2",
              "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0",
              "hover:bg-background aria-expanded:shadow-[0_0_1px_0px_var(--color-border)] aria-expanded:bg-background",
            )}
            disabled={isPending}
          />
        }
      >
        <div className="flex min-w-0 items-center gap-3 w-full">
          <StoreLogo
            logoUrl={currentStore?.logoUrl || null}
            name={currentStore?.name || "?"}
            size="md"
          />
          <div className="flex min-w-0 flex-col items-start group-data-[collapsible=icon]:hidden">
            <span className="w-full truncate text-sm font-medium">
              {currentStore?.name || t("selectStore")}
            </span>
            {currentStore && (
              <div className="flex items-center gap-1.5">
                <RoleBadge role={currentStore.role} t={t} />
                {!currentStore.onboardingCompleted && (
                  <span className="text-amber-600 dark:text-amber-500 text-xs">
                    {t("onboardingIncomplete")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50 group-data-[collapsible=icon]:hidden" />
      </PopoverTrigger>
      <PopoverPopup className="w-[260px] *:pt-0" align="start" sideOffset={8}>
        <Command open filter={null} autoHighlight={false} keepHighlight={false}>
          {stores.length > 5 && (
            <div className="border-b py-1.5">
              <CommandInput
                placeholder={t("searchStores")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}
          <CommandList className="max-h-[300px] not-empty:p-0">
            {filteredStores.length === 0 && searchQuery && (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {t("noStoresFound")}
              </div>
            )}
            <CommandGroup>
              <CommandGroupLabel>{t("yourStores")}</CommandGroupLabel>
              {filteredStores.map((store) => (
                <CommandItem
                  key={store.id}
                  value={store.name}
                  onClick={() => handleStoreSelect(store.id)}
                  className="cursor-pointer py-2"
                >
                  <div className="mr-3">
                    <StoreLogo logoUrl={store.logoUrl} name={store.name} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{store.name}</span>
                    <div className="flex items-center gap-1.5">
                      <RoleBadge role={store.role} t={t} />
                      {!store.onboardingCompleted && (
                        <span className="text-amber-600 dark:text-amber-500 text-xs">
                          {t("onboardingIncomplete")}
                        </span>
                      )}
                    </div>
                  </div>
                  {store.id === currentStoreId && (
                    <CheckIcon className="text-primary ml-2 h-4 w-4 shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {showMultiStore && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onClick={handleMultiStoreView} className="cursor-pointer py-2">
                    <div className="bg-primary/10 mr-3 flex size-6 items-center justify-center rounded-md md:size-8">
                      <BuildingIcon className="text-primary h-4" />
                    </div>
                    <span className="text-sm">{t("multiStoreView")}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
            {showCreateStore && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onClick={handleCreateStore} className="cursor-pointer py-2">
                    <div className="mr-3 flex h-6 w-6 items-center justify-center rounded-md border border-dashed">
                      <PlusIcon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-sm">{t("createNewStore")}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverPopup>
    </Popover>
  );
}
