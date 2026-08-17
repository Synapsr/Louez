"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useFormatter, useLocale, useTranslations } from "next-intl";

import type { MarketplaceChannelState } from "@louez/api/services";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPanel,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toastManager,
} from "@louez/ui";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LayersIcon,
  LinkIcon,
  ListCheckIcon,
  MapPinIcon,
  StoreIcon,
} from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import type { MarketplaceMatchCandidate } from "@/lib/marketplace-match";
import type { MarketplaceTaxonomyCategory } from "@/lib/marketplace-taxonomy";

import {
  confirmDirectoryClaim,
  disableMarketplaceChannel,
  dismissDirectoryClaim,
  enableMarketplaceChannel,
  saveCategoryMappings,
} from "./actions";

type ChannelStatus = NonNullable<MarketplaceChannelState["channel"]>["status"];

type StoreCategory = {
  id: string;
  name: string;
};

type MarketplaceChannelFormProps = {
  channelState: MarketplaceChannelState;
  matchCandidates: MarketplaceMatchCandidate[] | null;
  storeCategories: StoreCategory[];
  storefrontUrl: string;
  taxonomy: MarketplaceTaxonomyCategory[] | null;
};

/** Checklist rows whose remedy lives on another settings/dashboard page. */
const CHECKLIST_ITEMS = [
  { key: "addressAndGeolocation", href: "/dashboard/settings" },
  { key: "activeProductWithImageAndPrice", href: "/dashboard/products" },
  { key: "stripeChargesEnabled", href: "/dashboard/settings/payments" },
  { key: "cgvPresent", href: "/dashboard/settings/legal" },
] as const;

const MARKETPLACE_BENEFITS = ["visibility", "seo", "free"] as const;

const DISABLE_CONSEQUENCES = ["search", "redirect", "links"] as const;

const STATUS_VARIANT: Record<ChannelStatus, "warning" | "pending" | "success" | "expired"> = {
  setup_required: "warning",
  pending: "pending",
  published: "success",
  paused: "expired",
  disabled: "expired",
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Order-independent signature so dirty state ignores key insertion order. */
function serializeMappings(mappings: Record<string, string>): string {
  return Object.entries(mappings)
    .map(([categoryId, slug]) => [categoryId, slug.trim()] as const)
    .filter(([, slug]) => slug.length > 0)
    .map(([categoryId, slug]) => `${categoryId}:${slug}`)
    .sort()
    .join("|");
}

export function MarketplaceChannelForm({
  channelState,
  matchCandidates,
  storeCategories,
  storefrontUrl,
  taxonomy,
}: MarketplaceChannelFormProps) {
  const t = useTranslations("dashboard.settings.salesChannels");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [claimPromptDismissed, setClaimPromptDismissed] = useState(false);

  const { channel, checklist } = channelState;
  const isEnabled = channel?.enabledByOwner === true;
  const termsAccepted = checklist.marketplaceTermsAccepted;
  const confirmedCandidate =
    matchCandidates?.find((candidate) => candidate.businessId === channel?.claimedBusinessId) ??
    null;

  const initialMappings = useMemo(() => {
    const next: Record<string, string> = {};
    for (const mapping of channelState.categoryMappings) {
      next[mapping.categoryId] = mapping.marketplaceCategorySlug;
    }

    return next;
  }, [channelState.categoryMappings]);

  const [baselineMappings, setBaselineMappings] = useState(initialMappings);
  const [mappings, setMappings] = useState(initialMappings);

  const isMappingDirty = serializeMappings(mappings) !== serializeMappings(baselineMappings);

  const resolveTaxonomyName = useMemo(() => {
    return (category: MarketplaceTaxonomyCategory): string =>
      category.name[locale] ?? category.name.fr ?? category.name.en ?? category.slug;
  }, [locale]);

  /** Roots first, each immediately followed by its children (one level deep). */
  const taxonomyOptions = useMemo(() => {
    if (!taxonomy) {
      return null;
    }

    const sorted = [...taxonomy].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        resolveTaxonomyName(left).localeCompare(resolveTaxonomyName(right), locale),
    );
    const bySlug = new Set(sorted.map((category) => category.slug));
    const childrenByParent = new Map<string, MarketplaceTaxonomyCategory[]>();
    for (const category of sorted) {
      if (category.parentSlug === null || !bySlug.has(category.parentSlug)) {
        continue;
      }
      const siblings = childrenByParent.get(category.parentSlug) ?? [];
      siblings.push(category);
      childrenByParent.set(category.parentSlug, siblings);
    }

    const options: Array<{ depth: number; label: string; slug: string }> = [];
    for (const category of sorted) {
      if (category.parentSlug !== null && bySlug.has(category.parentSlug)) {
        continue;
      }
      options.push({ depth: 0, label: resolveTaxonomyName(category), slug: category.slug });
      for (const child of childrenByParent.get(category.slug) ?? []) {
        options.push({ depth: 1, label: resolveTaxonomyName(child), slug: child.slug });
      }
    }

    return options;
  }, [locale, resolveTaxonomyName, taxonomy]);

  const taxonomyLabelBySlug = useMemo(() => {
    return new Map((taxonomyOptions ?? []).map((option) => [option.slug, option.label] as const));
  }, [taxonomyOptions]);

  const completedCount =
    CHECKLIST_ITEMS.filter((item) => checklist[item.key]).length + (termsAccepted ? 1 : 0);
  const totalCount = CHECKLIST_ITEMS.length + 1;

  const statusReasonText = useMemo(() => {
    const reason = channel?.statusReason;
    if (!reason) {
      return null;
    }
    if (reason === "disabled_by_owner") {
      return t("status.reason.disabledByOwner");
    }
    if (reason.startsWith("missing:")) {
      return t("status.reason.missing");
    }

    return reason;
  }, [channel?.statusReason, t]);

  // Server actions surface `ApiServiceError` keys verbatim ("errors.<name>").
  const notifyError = (key: string | undefined) => {
    const errorKey = key?.startsWith("errors.") === true ? key.slice("errors.".length) : null;
    const message =
      errorKey !== null && tErrors.has(errorKey) ? tErrors(errorKey) : tErrors("generic");
    toastManager.add({ title: message, type: "error" });
  };

  const handleEnable = (acceptTerms: boolean) => {
    startTransition(async () => {
      const result = await enableMarketplaceChannel({ acceptTerms });
      if ("error" in result) {
        notifyError(result.error);
        return;
      }

      toastManager.add({
        title: acceptTerms ? t("toasts.termsAccepted") : t("toasts.enabled"),
        type: "success",
      });
      router.refresh();
    });
  };

  const handleDisable = () => {
    startTransition(async () => {
      const result = await disableMarketplaceChannel();
      if ("error" in result) {
        notifyError(result.error);
        return;
      }

      toastManager.add({ title: t("toasts.disabled"), type: "success" });
      router.refresh();
    });
  };

  const handleSaveMappings = () => {
    const payload = Object.entries(mappings)
      .map(([categoryId, slug]) => ({
        categoryId,
        marketplaceCategorySlug: slug.trim(),
      }))
      .filter((mapping) => mapping.marketplaceCategorySlug.length > 0);

    if (payload.some((mapping) => !SLUG_PATTERN.test(mapping.marketplaceCategorySlug))) {
      toastManager.add({ title: t("mapping.invalidSlug"), type: "error" });
      return;
    }

    startTransition(async () => {
      const result = await saveCategoryMappings(payload);
      if ("error" in result) {
        notifyError(result.error);
        return;
      }

      setBaselineMappings(mappings);
      toastManager.add({ title: t("mapping.saved"), type: "success" });
      router.refresh();
    });
  };

  const handleConfirmDirectoryClaim = (candidate: MarketplaceMatchCandidate) => {
    startTransition(async () => {
      const result = await confirmDirectoryClaim({ businessId: candidate.businessId });
      if ("error" in result) {
        notifyError(result.error);
        return;
      }

      toastManager.add({ title: t("claim.confirmedToast"), type: "success" });
      router.refresh();
    });
  };

  const handleDismissDirectoryClaim = (unlink: boolean) => {
    startTransition(async () => {
      const result = await dismissDirectoryClaim({});
      if ("error" in result) {
        notifyError(result.error);
        return;
      }

      setClaimPromptDismissed(!unlink);
      toastManager.add({
        title: t(unlink ? "claim.unlinkedToast" : "claim.dismissedToast"),
        type: "success",
      });
      if (unlink) {
        router.refresh();
      }
    });
  };

  const updateMapping = (categoryId: string, slug: string) => {
    setMappings((previous) => ({ ...previous, [categoryId]: slug }));
  };

  return (
    <div className="min-w-0 space-y-6">
      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">{t("channels.heading")}</h3>
          <p className="text-muted-foreground text-sm">{t("channels.subheading")}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card
            className={cn(
              "min-w-0 transition-colors",
              isEnabled && "border-primary/50 bg-primary/[0.03]",
            )}
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <DashboardIconTile icon={GlobeIcon} accent="primary" />
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {t("channels.marketplace.name")}
                      <Badge variant="default">{t("channels.marketplace.recommended")}</Badge>
                    </CardTitle>
                    <CardDescription>{t("channels.marketplace.description")}</CardDescription>
                  </div>
                </div>
                <Switch
                  aria-label={t("channels.marketplace.enableLabel")}
                  checked={isEnabled}
                  disabled={isPending}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handleEnable(false);
                      return;
                    }
                    setDisableDialogOpen(true);
                  }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {MARKETPLACE_BENEFITS.map((benefit) => (
                  <li
                    key={benefit}
                    className="text-muted-foreground flex items-start gap-2 text-sm"
                  >
                    <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" />
                    <span>{t(`channels.marketplace.benefits.${benefit}`)}</span>
                  </li>
                ))}
              </ul>

              {channel && (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                      {t("status.label")}
                    </span>
                    <Badge variant={STATUS_VARIANT[channel.status]}>
                      {t(`status.values.${channel.status}`)}
                    </Badge>
                  </div>
                  {statusReasonText && (
                    <p className="text-muted-foreground text-sm">{statusReasonText}</p>
                  )}
                  {channel.publishedAt && (
                    <p className="text-muted-foreground text-xs">
                      {t("status.publishedAt", {
                        date: format.dateTime(new Date(channel.publishedAt), {
                          dateStyle: "medium",
                        }),
                      })}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <div className="flex items-start gap-3">
                <DashboardIconTile icon={StoreIcon} />
                <div className="min-w-0 space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {t("channels.storefront.name")}
                    <Badge variant="tertiary">{t("channels.storefront.alwaysOn")}</Badge>
                  </CardTitle>
                  <CardDescription>{t("channels.storefront.description")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">{t("channels.storefront.note")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  render={<a href={storefrontUrl} target="_blank" rel="noreferrer" />}
                >
                  <ExternalLinkIcon className="size-4" />
                  {t("channels.storefront.viewAction")}
                </Button>
                <Button variant="ghost" render={<Link href="/dashboard/settings/appearance" />}>
                  {t("channels.storefront.customizeAction")}
                  <ArrowRightIcon className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {isEnabled && (
        <>
          {channel?.claimedBusinessId ? (
            <Card className="border-primary/40 bg-primary/[0.03]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LinkIcon className="text-primary size-5 shrink-0" />
                  {t("claim.linkedTitle")}
                </CardTitle>
                <CardDescription>{t("claim.linkedDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium">
                      {confirmedCandidate?.name ?? t("claim.linkedFallback")}
                    </p>
                    <code className="text-muted-foreground block truncate text-xs">
                      {confirmedCandidate?.slug ?? channel.claimedBusinessId}
                    </code>
                    <p className="text-muted-foreground text-xs">{t("claim.mergeHint")}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 self-start sm:self-auto"
                    disabled={isPending}
                    onClick={() => handleDismissDirectoryClaim(true)}
                  >
                    {t("claim.unlinkAction")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            matchCandidates &&
            matchCandidates.length > 0 &&
            !claimPromptDismissed && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPinIcon className="size-5 shrink-0" />
                    {t("claim.title")}
                  </CardTitle>
                  <CardDescription>{t("claim.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="divide-y rounded-lg border">
                    {matchCandidates.map((candidate) => {
                      const distanceLabel =
                        candidate.distanceM === null
                          ? null
                          : candidate.distanceM < 1000
                            ? t("claim.distanceMeters", {
                                distance: format.number(Math.round(candidate.distanceM)),
                              })
                            : t("claim.distanceKilometers", {
                                distance: format.number(candidate.distanceM / 1000, {
                                  maximumFractionDigits: 1,
                                }),
                              });

                      return (
                        <li
                          key={candidate.businessId}
                          className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="truncate text-sm font-medium">{candidate.name}</p>
                            {candidate.address !== "" && (
                              <p className="text-muted-foreground text-sm">{candidate.address}</p>
                            )}
                            {distanceLabel !== null && (
                              <p className="text-muted-foreground text-xs">{distanceLabel}</p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 self-start sm:self-auto"
                            disabled={isPending}
                            onClick={() => handleConfirmDirectoryClaim(candidate)}
                          >
                            {t("claim.confirmAction")}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                  <Button
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => handleDismissDirectoryClaim(false)}
                  >
                    {t("claim.noneAction")}
                  </Button>
                </CardContent>
              </Card>
            )
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListCheckIcon className="size-5 shrink-0" />
                {t("checklist.title")}
              </CardTitle>
              <CardDescription>{t("checklist.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={checklist.complete ? "success" : "pending"}>
                  {t("checklist.progress", { done: completedCount, total: totalCount })}
                </Badge>
                {checklist.complete && (
                  <span className="text-muted-foreground text-sm">
                    {t("checklist.completeDescription")}
                  </span>
                )}
              </div>

              <ul className="space-y-2">
                {CHECKLIST_ITEMS.map((item) => {
                  const done = checklist[item.key];

                  return (
                    <li
                      key={item.key}
                      className={cn(
                        "flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 transition-colors",
                        done && "border-primary/40 bg-primary/[0.03]",
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        {done ? (
                          <CheckCircleIcon className="text-primary mt-0.5 size-5 shrink-0" />
                        ) : (
                          <CircleIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                        )}
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-medium">
                            {t(`checklist.items.${item.key}.label`)}
                          </p>
                          <p className="text-muted-foreground text-sm">
                            {t(`checklist.items.${item.key}.description`)}
                          </p>
                        </div>
                      </div>
                      {done ? (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {t("checklist.doneLabel")}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          render={<Link href={item.href} />}
                        >
                          {t("checklist.fixAction")}
                        </Button>
                      )}
                    </li>
                  );
                })}

                <li
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    termsAccepted && "border-primary/40 bg-primary/[0.03]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="marketplace-terms"
                      className="mt-0.5"
                      checked={termsAccepted}
                      disabled={termsAccepted || isPending}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          handleEnable(true);
                        }
                      }}
                    />
                    <div className="min-w-0 space-y-0.5">
                      <Label htmlFor="marketplace-terms" className="text-sm font-medium">
                        {t("checklist.items.marketplaceTermsAccepted.label")}
                      </Label>
                      <p className="text-muted-foreground text-sm">
                        {t("checklist.items.marketplaceTermsAccepted.description")}
                      </p>
                      {channel?.termsAcceptedAt && (
                        <p className="text-muted-foreground text-xs">
                          {t("checklist.items.marketplaceTermsAccepted.acceptedAt", {
                            date: format.dateTime(new Date(channel.termsAcceptedAt), {
                              dateStyle: "medium",
                            }),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LayersIcon className="size-5 shrink-0" />
                {t("mapping.title")}
              </CardTitle>
              <CardDescription>{t("mapping.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {taxonomyOptions === null && (
                <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                  {t("mapping.fallbackHint")}
                </p>
              )}

              {storeCategories.length === 0 ? (
                <div className="space-y-3 rounded-md border border-dashed p-4">
                  <p className="text-muted-foreground text-sm">{t("mapping.empty")}</p>
                  <Button variant="outline" render={<Link href="/dashboard/categories" />}>
                    {t("mapping.emptyAction")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {storeCategories.map((category) => {
                    const value = mappings[category.id] ?? "";
                    const fieldId = `marketplace-mapping-${category.id}`;

                    return (
                      <div
                        key={category.id}
                        className="grid gap-2 sm:grid-cols-[1fr_1fr] sm:items-center sm:gap-4"
                      >
                        <Label htmlFor={fieldId} className="min-w-0 truncate">
                          {category.name}
                        </Label>
                        {taxonomyOptions === null ? (
                          <Input
                            id={fieldId}
                            value={value}
                            disabled={isPending}
                            placeholder={t("mapping.fallbackPlaceholder")}
                            onChange={(event) => updateMapping(category.id, event.target.value)}
                          />
                        ) : (
                          <Select
                            value={value}
                            disabled={isPending}
                            onValueChange={(selected) => {
                              if (typeof selected === "string") {
                                updateMapping(category.id, selected);
                              }
                            }}
                          >
                            <SelectTrigger id={fieldId}>
                              <SelectValue>
                                {taxonomyLabelBySlug.get(value) ?? t("mapping.none")}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">{t("mapping.none")}</SelectItem>
                              {taxonomyOptions.map((option) => (
                                <SelectItem
                                  key={option.slug}
                                  value={option.slug}
                                  className={option.depth > 0 ? "ps-6" : undefined}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={disableDialogOpen} onOpenChange={(open) => setDisableDialogOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disable.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("disable.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogPanel>
            <ul className="text-muted-foreground space-y-2 text-sm">
              {DISABLE_CONSEQUENCES.map((consequence) => (
                <li key={consequence} className="flex items-start gap-2">
                  <ArrowRightIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{t(`disable.consequences.${consequence}`)}</span>
                </li>
              ))}
            </ul>
          </AlertDialogPanel>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("disable.cancel")}
            </AlertDialogClose>
            <AlertDialogClose render={<Button variant="destructive" />} onClick={handleDisable}>
              {t("disable.confirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isEnabled && storeCategories.length > 0 && (
        <FloatingSaveBar
          isDirty={isMappingDirty}
          isLoading={isPending}
          onReset={() => setMappings(baselineMappings)}
          onSubmit={handleSaveMappings}
        />
      )}
    </div>
  );
}
