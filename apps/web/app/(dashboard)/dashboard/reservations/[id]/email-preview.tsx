"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Skeleton,
} from "@louez/ui";
import { EyeIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import type { ManualEmailRenderContext } from "@/lib/email/manual-reservation-email-core";

import { orpc } from "@/lib/orpc/react";

// The renderer chunk carries the email templates, their messages and the
// react-email browser renderer — loaded only once a preview is on screen.
const EmailPreviewRenderer = dynamic(() => import("./email-preview-client"), {
  ssr: false,
  loading: () => <Skeleton className="h-24 w-full rounded-lg" />,
});

interface EmailPreviewProps {
  context?: ManualEmailRenderContext;
  reservationId: string;
  templateId: string | null;
  customSubject?: string;
  customMessage?: string;
  /** Skip fetching while the preview is not on screen. */
  enabled?: boolean;
  className?: string;
  frameClassName?: string;
}

/**
 * Renders the very email the send action would produce — same builder, run in
 * the browser — live as the form changes. One context fetch when the preview
 * appears; every keystroke after that renders locally.
 */
export function EmailPreview({
  reservationId,
  context: suppliedContext,
  templateId,
  customSubject,
  customMessage,
  enabled = true,
  className,
  frameClassName,
}: EmailPreviewProps) {
  const t = useTranslations("dashboard.reservations.emailModal");

  // A custom email is nothing until it has a body.
  const isReady =
    Boolean(templateId) && (templateId !== "custom" || Boolean(customMessage?.trim()));

  const contextQuery = useQuery({
    ...orpc.dashboard.reservations.getEmailRenderContext.queryOptions({
      input: { reservationId },
    }),
    enabled: enabled && !suppliedContext,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const context = suppliedContext ?? contextQuery.data;

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      {!isReady && (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center",
            frameClassName,
          )}
        >
          <EyeIcon className="size-5 text-muted-foreground" />
          <p className="text-muted-foreground text-xs">{t("previewPlaceholder")}</p>
        </div>
      )}

      {isReady && !context && contextQuery.isPending && (
        <>
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className={cn("w-full rounded-lg", frameClassName)} />
        </>
      )}

      {isReady && !context && contextQuery.isError && (
        <div
          className={cn(
            "flex items-center justify-center rounded-lg border border-dashed p-6 text-center",
            frameClassName,
          )}
        >
          <p className="text-destructive text-xs">{t("previewError")}</p>
        </div>
      )}

      {isReady && context && templateId && (
        <EmailPreviewRenderer
          inert={Boolean(suppliedContext)}
          context={context}
          customMessage={customMessage}
          customSubject={customSubject}
          frameClassName={frameClassName}
          templateId={templateId}
        />
      )}
    </div>
  );
}

interface EmailPreviewDialogProps extends EmailPreviewProps {
  autoFocus?: boolean;
  modal?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerFirstName: string;
}

/** The same preview as a dialog, for viewports too narrow to show it beside the form. */
export function EmailPreviewDialog({
  open,
  onOpenChange,
  customerFirstName,
  autoFocus = true,
  modal = true,
  ...previewProps
}: EmailPreviewDialogProps) {
  const t = useTranslations("dashboard.reservations.emailModal");
  const tCommon = useTranslations("common");

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogPopup initialFocus={autoFocus} finalFocus={autoFocus} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("previewTitle")}</DialogTitle>
          <DialogDescription>
            {t("previewDescription", { name: customerFirstName })}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <EmailPreview {...previewProps} enabled={open} frameClassName="h-[45vh]" />
        </DialogPanel>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {tCommon("close")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
