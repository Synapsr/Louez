"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import type { DemoVerticalKey } from "@/lib/demo/verticals/types";

type StartError = "rate_limited" | "capacity" | "failed";
type StartAnswer = {
  ok: boolean;
  body: { redirectTo?: string; error?: StartError; retryAfterSeconds?: number | null };
};

type LaunchState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "error"; error: StartError };

declare global {
  interface Window {
    /** The request the page's HTML sent before hydration (app/demo/[vertical]/page.tsx). */
    __louezDemoStart?: Promise<StartAnswer>;
    /** Set by that request when it already sent the browser to the storefront. */
    __louezDemoNavigating?: boolean;
  }
}

/** A busy instance asks to come back in a few seconds: the launcher waits and asks again, a few times. */
const MAX_BUSY_RETRIES = 3;

const requestStart = (vertical: DemoVerticalKey): Promise<StartAnswer> =>
  fetch("/api/demo/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vertical }),
  })
    .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => ({})) }))
    .catch(() => ({ ok: false, body: {} }));

/**
 * Opens the visitor's demo store (POST /api/demo/start) and goes to its
 * storefront. The page's HTML already sent the request; this takes its answer
 * over. A visitor signed in to their own account confirms first, as the demo
 * signs them out of it.
 */
export function DemoLauncher({
  vertical,
  autoStart,
  signedIn,
}: {
  vertical: DemoVerticalKey;
  autoStart: boolean;
  signedIn: boolean;
}) {
  const t = useTranslations("demo.launcher");
  const [state, setState] = useState<LaunchState>({ kind: autoStart ? "starting" : "idle" });
  const started = useRef(false);

  const start = useCallback(
    async (early?: Promise<StartAnswer>) => {
      setState({ kind: "starting" });
      let answer = await (early ?? requestStart(vertical));
      for (
        let retry = 0;
        !answer.ok && answer.body.error === "capacity" && retry < MAX_BUSY_RETRIES;
        retry++
      ) {
        const seconds = Math.min(answer.body.retryAfterSeconds ?? 3, 10);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        answer = await requestStart(vertical);
      }
      if (answer.ok && answer.body.redirectTo) {
        setState({ kind: "ready" });
        // The bar completes and the page fades, then the storefront comes in. The
        // page's own request may already be on its way there.
        if (window.__louezDemoNavigating) return;
        document.documentElement.dataset.demoReady = "";
        const target = answer.body.redirectTo;
        window.setTimeout(() => window.location.assign(target), 120);
        return;
      }
      setState({ kind: "error", error: answer.body.error ?? "failed" });
    },
    [vertical],
  );

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    const early = window.__louezDemoStart;
    window.__louezDemoStart = undefined;
    void start(early);
  }, [autoStart, start]);

  if (state.kind === "starting" || state.kind === "ready") {
    return (
      <div className="mt-8 flex w-full flex-col items-center" role="status" aria-live="polite">
        <div className="h-[3px] w-40 overflow-hidden rounded-full bg-foreground/10">
          <div
            className={cn(
              "h-full rounded-full bg-(--demo-accent)",
              state.kind === "ready"
                ? "w-full transition-[width] duration-150 ease-out"
                : "w-0 motion-safe:animate-[demo-progress_2.4s_cubic-bezier(0.16,1,0.3,1)_forwards] motion-reduce:w-2/3 [[data-demo-ready]_&]:w-full [[data-demo-ready]_&]:animate-none",
            )}
          />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {state.kind === "ready" ? t("ready") : t("preparing")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 flex w-full flex-col items-center gap-4">
      {state.kind === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      {signedIn && state.kind === "idle" ? (
        <p className="text-sm text-muted-foreground">{t("signedInNotice")}</p>
      ) : null}
      <Button size="lg" onClick={() => void start()}>
        {state.kind === "error" ? t("retry") : t("start")}
      </Button>
    </div>
  );
}
