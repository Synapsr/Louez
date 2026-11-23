"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ExternalLink, ListChecks } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import type { DemoGuideLink } from "@/lib/demo/demo-dashboard";

import { trackDemoStep } from "./track-demo-step";

const STORAGE_KEY = "louez-demo-guide";

interface GuideMemory {
  open: boolean;
  done: string[];
}

function readMemory(storeId: string): GuideMemory {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY}:${storeId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GuideMemory>;
      return { open: parsed.open !== false, done: Array.isArray(parsed.done) ? parsed.done : [] };
    }
  } catch {
    // No storage (private window): the guide starts as it would the first time.
  }
  // Folded on a phone, where it would cover the page; open elsewhere.
  return { open: window.matchMedia("(min-width: 768px)").matches, done: [] };
}

function writeMemory(storeId: string, memory: GuideMemory): void {
  try {
    window.localStorage.setItem(`${STORAGE_KEY}:${storeId}`, JSON.stringify(memory));
  } catch {
    // Nothing to keep it in.
  }
}

const STEP_EVENTS = {
  book: "storefront_opened",
  see_booking: "booking_opened",
  check_in: "check_in_opened",
  deposit: "deposit_opened",
  catalog: "guide_step_clicked",
} as const;

/**
 * « À essayer »: the few things that show the trade's day in Louez, each a
 * link into the demo store. A small card in a corner, which folds away when a
 * step is opened; the steps opened are ticked, in this browser only.
 */
export function DemoGuide({ storeId, steps }: { storeId: string; steps: DemoGuideLink[] }) {
  const t = useTranslations("demo.guide");
  const [memory, setMemory] = useState<GuideMemory>({ open: true, done: [] });

  useEffect(() => {
    setMemory(readMemory(storeId));
  }, [storeId]);

  const update = (next: GuideMemory) => {
    setMemory(next);
    writeMemory(storeId, next);
  };

  const markDone = (key: DemoGuideLink["key"]) => {
    trackDemoStep(STEP_EVENTS[key], key);
    // The card folds away to leave the page it opens in view.
    update({ open: false, done: memory.done.includes(key) ? memory.done : [...memory.done, key] });
  };

  const doneCount = steps.filter((step) => memory.done.includes(step.key)).length;

  return (
    <aside
      className="fixed right-4 bottom-4 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border bg-background shadow-lg"
      aria-label={t("title")}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold"
        aria-expanded={memory.open}
        onClick={() => update({ ...memory, open: !memory.open })}
      >
        <ListChecks className="size-4 text-primary" aria-hidden />
        <span className="flex-1">{t("title")}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {t("progress", { done: doneCount, total: steps.length })}
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", memory.open ? "rotate-180" : "")}
          aria-hidden
        />
      </button>
      {memory.open ? (
        <ol className="space-y-1 border-t px-2 py-2">
          {steps.map((step, index) => {
            const done = memory.done.includes(step.key);
            const content = (
              <>
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {step.title}
                    {step.external ? (
                      <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{step.description}</span>
                </span>
              </>
            );
            const className = "flex gap-3 rounded-lg px-2 py-2 hover:bg-muted";
            return (
              <li key={step.key}>
                {step.external ? (
                  <a
                    href={step.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={className}
                    onClick={() => markDone(step.key)}
                  >
                    {content}
                  </a>
                ) : (
                  <Link href={step.href} className={className} onClick={() => markDone(step.key)}>
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </aside>
  );
}
