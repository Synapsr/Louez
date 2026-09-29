"use client";

import { useEffect, useMemo, useRef } from "react";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
// eslint-disable-next-line no-restricted-imports
import { formatDistance } from "date-fns";
import { enUS, fr, type Locale } from "date-fns/locale";
import { Activity } from "lucide-react";

import type { ProductUnitActivityCursor, ProductUnitActivityPage } from "@louez/api/services";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ScrollArea } from "@louez/ui";
import { RepeatSolidIcon, SpinnerSolidIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { EmptyState } from "@/components/ui/empty-state";
import { orpc } from "@/lib/orpc/react";

import { UNIT_EVENT_CONFIG, type UnitEventType } from "./product-unit-activity.constants";
import { groupReservationActivity } from "./util.product-activity";

// Mirrors `apps/web/lib/utils/store-date.ts`'s LOCALE_MAP convention, scoped
// to the two locales this app actually ships (see apps/web/messages/).
const LOCALE_MAP: Record<string, Locale> = { fr, en: enUS };

interface ProductActivityFeedProps {
  initialPage: ProductUnitActivityPage;
  locale: string;
  productId: string;
  referenceDate: string;
  readOnly?: boolean;
}

export const ProductActivityFeed = ({
  initialPage,
  locale,
  productId,
  referenceDate,
  readOnly = false,
}: ProductActivityFeedProps) => {
  const t = useTranslations();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const dateFnsLocale = LOCALE_MAP[locale] ?? fr;
  const referenceNow = new Date(referenceDate);

  const query = useInfiniteQuery(
    orpc.dashboard.products.activity.infiniteOptions({
      input: (cursor: ProductUnitActivityCursor | undefined) => ({
        productId,
        cursor,
      }),
      initialData: {
        pages: [initialPage],
        pageParams: [undefined],
      },
      initialPageParam: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: 30_000,
      enabled: !readOnly,
    }),
  );

  const activity = useMemo(
    () => readOnly ? initialPage.items : query.data.pages.flatMap((page) => page.items),
    [readOnly, initialPage.items, query.data.pages],
  );
  const groupedActivity = useMemo(() => groupReservationActivity(activity), [activity]);
  const shouldConstrainHeight = query.hasNextPage || groupedActivity.length > 7;

  useEffect(() => {
    const target = loadMoreRef.current;
    const viewport =
      scrollAreaRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ??
      null;

    if (
      readOnly ||
      !target ||
      !viewport ||
      !query.hasNextPage ||
      query.isFetchingNextPage ||
      query.isFetchNextPageError
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void query.fetchNextPage();
        }
      },
      {
        root: viewport,
        rootMargin: "0px 0px 96px",
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [
    readOnly,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchNextPageError,
    query.isFetchingNextPage,
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4" />
          {t("dashboard.products.detail.activity.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <EmptyState icon={Activity} title={t("dashboard.products.detail.activity.empty")} />
        ) : (
          <div ref={scrollAreaRef}>
            <ScrollArea
              className={cn("w-full", shouldConstrainHeight ? "h-96" : "h-auto")}
              scrollFade
              scrollbarGutter
            >
              <ul className="space-y-3 py-1 pr-1">
                {groupedActivity.map(({ event, identifiers }) => {
                  const eventType = event.type as UnitEventType;
                  const config = UNIT_EVENT_CONFIG[eventType] ?? UNIT_EVENT_CONFIG.updated;
                  const Icon = config.icon;

                  return (
                    <li key={event.id} className="flex items-start gap-2.5">
                      <Badge
                        aria-hidden="true"
                        className="mt-0.5 size-6 min-w-0 rounded-full p-0"
                        variant={config.variant}
                      >
                        <Icon />
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium">
                            {t(`dashboard.products.detail.activity.types.${eventType}`)}
                          </span>
                          {identifiers.length > 1 && (
                            <span className="text-muted-foreground"> ×{identifiers.length}</span>
                          )}
                          {identifiers.length > 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {identifiers.join(", ")}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistance(new Date(event.createdAt), referenceNow, {
                            addSuffix: true,
                            locale: dateFnsLocale,
                          })}
                        </p>
                      </div>
                    </li>
                  );
                })}

                {!readOnly && query.hasNextPage && (
                  <li aria-live="polite" className="flex min-h-9 items-center justify-center">
                    <div ref={loadMoreRef}>
                      {query.isFetchNextPageError ? (
                        <Button
                          onClick={() => void query.fetchNextPage()}
                          size="sm"
                          variant="ghost"
                        >
                          <RepeatSolidIcon />
                          {t("common.refresh")}
                        </Button>
                      ) : query.isFetchingNextPage ? (
                        <span
                          aria-label={t("common.loading")}
                          className="text-muted-foreground inline-flex"
                          role="status"
                        >
                          <SpinnerSolidIcon aria-hidden="true" className="size-4 animate-spin" />
                        </span>
                      ) : null}
                    </div>
                  </li>
                )}
              </ul>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
