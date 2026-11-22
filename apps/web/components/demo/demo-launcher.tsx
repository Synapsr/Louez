"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Spinner } from "@louez/ui";

import type { DemoVerticalKey } from "@/lib/demo/verticals/types";

type LaunchState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "error"; error: "rate_limited" | "capacity" | "failed" };

/**
 * Opens the visitor's demo store (POST /api/demo/start) and goes to its
 * dashboard. Starts by itself, unless the visitor is signed in to their own
 * account: then they confirm first, as the demo signs them out of it.
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

  const start = useCallback(async () => {
    setState({ kind: "starting" });
    try {
      const response = await fetch("/api/demo/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vertical }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        redirectTo?: string;
        error?: "rate_limited" | "capacity" | "failed";
      };
      if (response.ok && body.redirectTo) {
        window.location.assign(body.redirectTo);
        return;
      }
      setState({ kind: "error", error: body.error ?? "failed" });
    } catch {
      setState({ kind: "error", error: "failed" });
    }
  }, [vertical]);

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void start();
  }, [autoStart, start]);

  if (state.kind === "starting") {
    return (
      <div className="mt-8 flex items-center gap-3 text-sm" role="status">
        <Spinner />
        <span>{t("preparing")}</span>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      {state.kind === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      {signedIn && state.kind === "idle" ? (
        <p className="text-sm text-muted-foreground">{t("signedInNotice")}</p>
      ) : null}
      <Button size="lg" className="w-full" onClick={() => void start()}>
        {state.kind === "error" ? t("retry") : t("start")}
      </Button>
    </div>
  );
}
