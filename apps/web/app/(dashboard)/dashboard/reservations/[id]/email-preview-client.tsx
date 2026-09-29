"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Skeleton, Spinner } from "@louez/ui";
import { InfoCircleIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import {
  buildManualReservationEmailFromContext,
  type ManualEmailRenderContext,
} from "@/lib/email/manual-reservation-email-core";

import { createInertEmailDocument } from "@/lib/document-previews/util.inert-email-document";

interface EmailPreviewRendererProps {
  inert?: boolean;
  context: ManualEmailRenderContext;
  templateId: string;
  customSubject?: string;
  customMessage?: string;
  frameClassName?: string;
}

/**
 * Renders the very email the send action would produce — same isomorphic
 * builder — in the browser, on every keystroke. Kept in its own chunk (loaded
 * with `next/dynamic`) so the dashboard route doesn't pay for the templates,
 * their messages and the react-email renderer until a preview is on screen.
 */
export default function EmailPreviewRenderer({
  context,
  inert = false,
  templateId,
  customSubject,
  customMessage,
  frameClassName,
}: EmailPreviewRendererProps) {
  const t = useTranslations("dashboard.reservations.emailModal");

  const [rendered, setRendered] = useState<{ subject: string; html: string } | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const [hasError, setHasError] = useState(false);
  // Renders are async: a slow older render must never overwrite a newer one.
  const sequenceRef = useRef(0);

  useEffect(() => {
    const sequence = ++sequenceRef.current;
    const isCurrent = () => sequence === sequenceRef.current;

    setIsRendering(true);
    buildManualReservationEmailFromContext(context, {
      templateId,
      customSubject: customSubject || undefined,
      customMessage: customMessage || undefined,
    })
      .then((result) => {
        if (!isCurrent()) return;
        if ("error" in result) {
          setHasError(true);
        } else {
          setHasError(false);
          setRendered({ subject: result.subject, html: result.html });
        }
      })
      .catch(() => {
        if (isCurrent()) setHasError(true);
      })
      .finally(() => {
        if (isCurrent()) setIsRendering(false);
      });
  }, [context, templateId, customSubject, customMessage]);

  if (!rendered && isRendering) {
    return (
      <>
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className={cn("w-full rounded-lg", frameClassName)} />
      </>
    );
  }

  if (hasError && !rendered) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-dashed p-6 text-center",
          frameClassName,
        )}
      >
        <p className="text-destructive text-xs">{t("previewError")}</p>
      </div>
    );
  }

  if (!rendered) return null;

  return (
    <>
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs">{t("previewSubject")}</p>
          <p className="truncate font-medium text-sm">{rendered.subject}</p>
        </div>
        {isRendering && <Spinner className="mt-1 size-3.5 text-muted-foreground" />}
      </div>

      {/* Fully sandboxed: the email is untrusted markup as far as the
          dashboard is concerned, and its links must not navigate away. */}
      <iframe
        className={cn("w-full rounded-lg border bg-white", frameClassName)}
        sandbox=""
        srcDoc={inert ? createInertEmailDocument(rendered.html) : rendered.html}
        title={t("previewTitle")}
      />

      <p className="flex items-start gap-2 text-muted-foreground text-xs">
        <InfoCircleIcon className="mt-0.5 size-3.5 shrink-0" />
        {t("previewLinkNotice")}
      </p>
    </>
  );
}
