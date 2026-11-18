"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Code2, Store } from "lucide-react";
import { useTranslations } from "next-intl";

import type { VisibilityStepKey, VisibilityView } from "@louez/api/contracts/visibility";
import {
  Button,
  Card,
  CardPanel,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  toastManager,
} from "@louez/ui";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { apiErrorKey } from "@/lib/orpc/errors";
import { visibilityMutations, visibilityQueries } from "@/lib/queries/visibility.queries";

import { AiVisibilityCard } from "./ai-visibility-card";
import { GoogleBusinessPanel } from "./google-business-panel";
import { PosterPanel } from "./poster-panel";
import { SharePanel, type ShareableProduct } from "./share-panel";
import { useVisibilityAnalytics } from "./use-visibility-analytics";
import { visibilityCounts } from "./util.visibility-steps";
import { VisibilityChannelRow } from "./visibility-channel-row";
import { VisibilityStepRow } from "./visibility-step-row";
import { VisibilityVisitsCard } from "./visibility-visits-card";

const PLACEMENT = "page";

interface VisibilityGuideProps {
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeUrl: string;
  products: readonly ShareableProduct[];
  /** Read by the page on the server. */
  initialView: VisibilityView;
  /** « Être trouvé par les IA »; null for a store without it (`canUseAiVisibility`). */
  ai: Omit<ComponentProps<typeof AiVisibilityCard>, "storeId"> | null;
  /** The instance publishes to reeent (`MARKETPLACE_URL`). */
  marketplaceAvailable: boolean;
}

/**
 * The "Se faire connaître" page: three steps, the visits they brought, being
 * found by AI assistants, other channels.
 */
export const VisibilityGuide = ({
  storeId,
  storeName,
  storeSlug,
  storeUrl,
  products,
  initialView,
  ai,
  marketplaceAvailable,
}: VisibilityGuideProps) => {
  const t = useTranslations("dashboard.visibility");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const analytics = useVisibilityAnalytics(storeId);
  const { data: view } = useQuery({ ...visibilityQueries.get(), initialData: initialView });
  const [openStep, setOpenStep] = useState<VisibilityStepKey | null>(null);

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    analytics.viewed(PLACEMENT, visibilityCounts(initialView.steps));
  }, [analytics, initialView.steps]);

  const setStep = useMutation({
    ...visibilityMutations.setStep(),
    onSuccess: (step) => {
      analytics.stepCompleted(step.key, step.status);
      queryClient.setQueryData(visibilityQueries.get().queryKey, (current) =>
        current
          ? {
              ...current,
              steps: current.steps.map((candidate) =>
                candidate.key === step.key ? step : candidate,
              ),
            }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: visibilityQueries.key() });
      setOpenStep(null);
    },
    onError: (error) => {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
    },
  });

  const current = view.steps.find((step) => step.key === openStep) ?? null;

  const panelFor = (key: VisibilityStepKey) => {
    switch (key) {
      case "share_contacts":
        return (
          <SharePanel
            storeId={storeId}
            storeName={storeName}
            storeUrl={storeUrl}
            products={products}
            placement={PLACEMENT}
          />
        );
      case "qr_poster":
        return (
          <PosterPanel
            storeId={storeId}
            storeName={storeName}
            storeSlug={storeSlug}
            storeUrl={storeUrl}
            placement={PLACEMENT}
          />
        );
      case "google_business":
        return <GoogleBusinessPanel storeId={storeId} storeUrl={storeUrl} placement={PLACEMENT} />;
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("description")}</p>
      </div>

      <Card>
        <CardPanel className="divide-y p-0">
          {view.steps.map((step, index) => (
            <VisibilityStepRow
              key={step.key}
              step={step}
              index={index}
              onOpen={() => setOpenStep(step.key)}
            />
          ))}
        </CardPanel>
      </Card>

      <VisibilityVisitsCard visits={view.visits} />

      {ai && <AiVisibilityCard storeId={storeId} {...ai} />}

      <DashboardSectionCard title={t("other.title")} contentClassName="-mx-2 space-y-1 sm:-mx-3">
        {marketplaceAvailable && (
          <VisibilityChannelRow
            href="/dashboard/settings/marketplace"
            icon={Store}
            title={t("other.reeent.title")}
            description={t("other.reeent.description")}
          />
        )}
        <VisibilityChannelRow
          href="/dashboard/settings/integrations/widget"
          icon={Code2}
          title={t("other.website.title")}
          description={t("other.website.description")}
        />
      </DashboardSectionCard>

      <Dialog open={current !== null} onOpenChange={(open) => !open && setOpenStep(null)}>
        <DialogPopup className="sm:max-w-md">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>{t(`steps.${current.key}.title`)}</DialogTitle>
                <DialogDescription>{t(`steps.${current.key}.description`)}</DialogDescription>
              </DialogHeader>
              <DialogPanel>{panelFor(current.key)}</DialogPanel>
              <DialogFooter>
                {current.status === "todo" ? (
                  <>
                    <Button
                      variant="ghost"
                      disabled={setStep.isPending}
                      onClick={() => setStep.mutate({ step: current.key, status: "skipped" })}
                    >
                      {t("actions.skip")}
                    </Button>
                    <Button
                      disabled={setStep.isPending}
                      onClick={() => setStep.mutate({ step: current.key, status: "done" })}
                    >
                      <Check />
                      {t("actions.done")}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={setStep.isPending}
                    onClick={() => setStep.mutate({ step: current.key, status: "todo" })}
                  >
                    {t("actions.reopen")}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogPopup>
      </Dialog>
    </div>
  );
};
