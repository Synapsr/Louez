"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, ShoppingBag } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { useCartActions } from "@/contexts/cart-context";
import { useStorefrontBasePath } from "@/contexts/store-context";
import type { DemoStorefrontGuideData } from "@/lib/demo/demo-storefront";
import { resolveStorefrontHref } from "@/lib/util.storefront-href";

const STORAGE_KEY = "louez-demo-storefront-guide";

interface GuideMemory {
  open: boolean;
  active: string | null;
}

function readMemory(storeId: string): GuideMemory {
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_KEY}:${storeId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GuideMemory>;
      return {
        open: parsed.open !== false,
        active: typeof parsed.active === "string" ? parsed.active : null,
      };
    }
  } catch {
    // No storage (private window): the guide starts as it would the first time.
  }
  return { open: true, active: null };
}

function writeMemory(storeId: string, memory: GuideMemory): void {
  try {
    window.sessionStorage.setItem(`${STORAGE_KEY}:${storeId}`, JSON.stringify(memory));
  } catch {
    // Nothing to keep it in.
  }
}

/**
 * « Réservez comme un client »: the trade's two bookings to try on the demo
 * storefront, a simple one and one only this trade has. « Essayer » puts the
 * scenario's dates in the cart and opens its product; the card then lists the
 * few actions left. It folds to its header on the checkout (and steps aside
 * there on a small screen), and on a phone until opened; on a product page it
 * sits above the page's own bottom bar.
 */
export const DemoStorefrontGuide = ({
  storeId,
  guide,
}: {
  storeId: string;
  guide: DemoStorefrontGuideData;
}) => {
  const t = useTranslations("demo.storefrontGuide");
  const router = useRouter();
  const basePath = useStorefrontBasePath() ?? "";
  const { setPeriod } = useCartActions();
  const pathname = usePathname();
  const [memory, setMemory] = useState<GuideMemory>({ open: false, active: null });

  useEffect(() => {
    const stored = readMemory(storeId);
    // A phone shows the page first: the guide waits folded.
    const wide = window.matchMedia("(min-width: 768px)").matches;
    setMemory(stored.active || wide ? stored : { ...stored, open: false });
  }, [storeId]);

  const update = (next: GuideMemory) => {
    setMemory(next);
    writeMemory(storeId, next);
  };

  // The checkout's fields are the visitor's to fill: the card folds out of their way.
  const onCheckout = pathname?.includes("/checkout") ?? false;
  // A product page has its own bar at the bottom of a small screen: the card sits above it.
  const onProduct = pathname?.includes("/product/") ?? false;
  useEffect(() => {
    if (!onCheckout) return;
    setMemory((current) => {
      const folded = { ...current, open: false };
      writeMemory(storeId, folded);
      return folded;
    });
  }, [onCheckout, storeId]);

  const active = guide.scenarios.find((scenario) => scenario.key === memory.active) ?? null;

  const start = (scenario: DemoStorefrontGuideData["scenarios"][number]) => {
    setPeriod(scenario.startDate, scenario.endDate);
    // On a phone the product comes first: the card folds to its header.
    update({ open: window.matchMedia("(min-width: 768px)").matches, active: scenario.key });
    router.push(resolveStorefrontHref(basePath, scenario.productPath));
  };

  return (
    <aside
      data-slot="demo-storefront-guide"
      className={cn(
        "fixed bottom-4 left-4 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border bg-background text-foreground shadow-lg",
        onProduct && "max-lg:bottom-[calc(--spacing(26)+env(safe-area-inset-bottom,0px))]",
        // A small screen's checkout keeps its own button at the bottom: the card steps aside.
        onCheckout && "max-lg:hidden",
      )}
      aria-label={t("title")}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold"
        aria-expanded={memory.open}
        onClick={() => update({ ...memory, open: !memory.open })}
      >
        <ShoppingBag className="size-4 text-primary" aria-hidden />
        <span className="flex-1">{active ? active.title : t("title")}</span>
        <ChevronDown
          className={cn("size-4 transition-transform", memory.open ? "rotate-180" : "")}
          aria-hidden
        />
      </button>
      {memory.open ? (
        <div className="border-t px-4 pt-3 pb-4">
          {active ? (
            <>
              <p className="text-xs text-muted-foreground">{active.pitch}</p>
              <ol className="mt-3 space-y-2">
                {active.steps.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold text-muted-foreground"
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => update({ open: true, active: null })}
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {t("otherScenario")}
                </button>
                <a
                  href={`${guide.dashboardUrl}/reservations`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {t("ownerSide")}
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t("intro")}</p>
              <ul className="mt-3 space-y-2">
                {guide.scenarios.map((scenario) => (
                  <li key={scenario.key}>
                    <button
                      type="button"
                      onClick={() => start(scenario)}
                      className="group flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold tracking-wide text-primary uppercase">
                          {t(scenario.key === "simple" ? "simple" : "trade")}
                        </span>
                        <span className="mt-0.5 block text-sm font-medium">{scenario.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {scenario.pitch}
                        </span>
                      </span>
                      <ArrowRight
                        className="mt-5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                        aria-hidden
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
};
