"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { type ComponentType, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  Badge,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
  Radio,
  RadioGroup,
  Textarea,
  toastManager,
} from "@louez/ui";
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChatIcon,
  CheckSolidIcon,
  CreditCardIcon,
  EyeIcon,
  FileTextIcon,
  LinkIcon,
  SendIcon,
} from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { invalidateReservationAll, invalidateReservationDetail } from "@/lib/orpc/invalidation";
import type { DashboardAccent } from "@/components/dashboard/shared/dashboard-accent";
import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { useMediaQuery } from "@/hooks/use-media-query";
import { EmailPreview, EmailPreviewDialog } from "./email-preview";
import { orpc } from "@/lib/orpc/react";
import { reservationAnalyticsActions } from "@/lib/product-analytics/analytics-events";
import {
  captureReservationActionFailed,
  captureReservationActionStarted,
} from "@/lib/product-analytics/reservation-analytics-client";

import type { ManualEmailRenderContext } from "@/lib/email/manual-reservation-email-core";

type ReservationStatus =
  | "pending"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "rejected"
  | "quote"
  | "declined";

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface EmailTemplate {
  id: string;
  Icon: ComponentType<{ className?: string }>;
  accent: DashboardAccent;
  available: (status: ReservationStatus, isFullyPaid: boolean) => boolean;
}

const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "contract",
    Icon: FileTextIcon,
    accent: "progress",
    available: (status) => ["confirmed", "ongoing"].includes(status),
  },
  {
    id: "payment_request",
    Icon: CreditCardIcon,
    accent: "pending",
    available: (status, isFullyPaid) =>
      !isFullyPaid && !["cancelled", "rejected", "declined", "quote"].includes(status),
  },
  {
    id: "reminder_pickup",
    Icon: ArrowUpRightIcon,
    accent: "success",
    available: (status) => status === "confirmed",
  },
  {
    id: "reminder_return",
    Icon: ArrowDownRightIcon,
    accent: "submitted",
    available: (status) => status === "ongoing",
  },
  {
    id: "access_link",
    Icon: LinkIcon,
    accent: "review",
    available: (status) => !["cancelled", "rejected", "declined", "quote"].includes(status),
  },
  {
    id: "custom",
    Icon: ChatIcon,
    accent: "neutral",
    available: () => true,
  },
];

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/**
 * Which element actually scrolls varies: the panel's scroll area on desktop, the
 * sheet itself on mobile, and something else again once the keyboard pushes the
 * panel into its `display: contents` layout. So find it instead of assuming it.
 */
const findScroller = (element: HTMLElement) => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    const scrolls = overflowY === "auto" || overflowY === "scroll";

    if (scrolls && node.scrollHeight > node.clientHeight) return node;
  }

  return null;
};

/** The fields are the last thing in the panel: its bottom shows them in full. */
const scrollFieldsIntoView = (fields: HTMLElement, behavior = scrollBehavior()) => {
  const scroller = findScroller(fields);

  if (scroller) {
    scroller.scrollTo({ behavior, top: scroller.scrollHeight });
    return;
  }

  fields.scrollIntoView({ behavior, block: "end" });
};

/**
 * iOS raises the keyboard once the tap has resolved, which relayouts the sheet
 * and drops the scroll we just did. It fires a resize per step of that animation
 * and the sheet re-lays itself out on its own, so keep re-anchoring for a moment
 * — instantly, to avoid smooth scrolls racing each other on every frame.
 */
const scrollFieldsIntoViewAfterKeyboard = (fields: HTMLElement) => {
  const visualViewport = window.visualViewport;
  if (!visualViewport) return;

  const handleResize = () => {
    requestAnimationFrame(() => scrollFieldsIntoView(fields, "auto"));
  };

  visualViewport.addEventListener("resize", handleResize);
  window.setTimeout(() => {
    visualViewport.removeEventListener("resize", handleResize);
  }, 1000);
};

interface SendEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationId: string;
  reservationNumber: string;
  customer: Customer;
  status: ReservationStatus;
  isFullyPaid: boolean;
  sentEmails?: string[];
  previewContext?: ManualEmailRenderContext;
  readOnly?: boolean;
  autoFocus?: boolean;
  modal?: boolean;
}

export function SendEmailModal({
  open,
  onOpenChange,
  reservationId,
  reservationNumber,
  customer,
  status,
  isFullyPaid,
  sentEmails = [],
  previewContext,
  readOnly = false,
  autoFocus = true,
  modal = true,
}: SendEmailModalProps) {
  const t = useTranslations("dashboard.reservations.emailModal");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const templateLabelId = useId();
  const subjectId = useId();
  const messageId = useId();

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [customSubject, setCustomSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Only wide viewports get the live preview beside the form: elsewhere it goes
  // behind a button, and gating it in JS keeps the request from firing at all.
  const showSidePreview = useMediaQuery("(min-width: 1024px)");

  const extraFieldsRef = useRef<HTMLDivElement>(null);
  // Arrow keys move through a radio group *and* change its value, so focusing the
  // field on every step would trap a keyboard user in the textarea. Tracking the
  // interaction beats reading `:focus-visible`, which browsers also set on a tap.
  const keyboardSelectionRef = useRef(false);

  // Choosing a template reveals fields below the fold, which is easy to miss —
  // on a phone they sit under the sheet's fold entirely. Committing the state
  // synchronously lets us focus the first field from inside the interaction, the
  // only way iOS agrees to open the keyboard, and scroll the block into view.
  const handleTemplateChange = (templateId: string) => {
    const keyboardDriven = keyboardSelectionRef.current;

    flushSync(() => {
      setSelectedTemplate(templateId);
    });

    const extraFields = extraFieldsRef.current;
    if (!extraFields) return;

    if (autoFocus && !keyboardDriven) {
      extraFields.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
      scrollFieldsIntoViewAfterKeyboard(extraFields);
    }
    scrollFieldsIntoView(extraFields);
  };

  const sendEmailMutation = useMutation(
    orpc.dashboard.reservations.sendReservationEmail.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservationId);
      },
    }),
  );

  const sendAccessLinkMutation = useMutation(
    orpc.dashboard.reservations.sendAccessLink.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationDetail(queryClient, reservationId);
      },
    }),
  );

  const availableTemplates = EMAIL_TEMPLATES.filter((template) =>
    template.available(status, isFullyPaid),
  );

  const handleSend = async () => {
    if (readOnly) return;
    if (!selectedTemplate) {
      toastManager.add({ title: t("selectTemplateError"), type: "error" });
      return;
    }

    if (selectedTemplate === "custom" && !customMessage.trim()) {
      toastManager.add({ title: t("customMessageRequired"), type: "error" });
      return;
    }

    captureReservationActionStarted({
      reservationId,
      reservationStatus: status,
      action: reservationAnalyticsActions.sendEmail,
      properties: { template_id: selectedTemplate, channel: "email" },
    });

    setIsLoading(true);
    try {
      if (selectedTemplate === "access_link") {
        await sendAccessLinkMutation.mutateAsync({
          reservationId,
          payload: { customMessage: customMessage || undefined },
        });
      } else {
        await sendEmailMutation.mutateAsync({
          reservationId,
          payload: {
            templateId: selectedTemplate,
            customSubject: customSubject || undefined,
            customMessage: customMessage || undefined,
          },
        });
      }

      toastManager.add({ title: t("sendSuccess"), type: "success" });
      onOpenChange(false);
      resetForm();
    } catch {
      captureReservationActionFailed({
        reservationId,
        reservationStatus: status,
        action: reservationAnalyticsActions.sendEmail,
        properties: {
          template_id: selectedTemplate,
          channel: "email",
          error_code: "email_send_failed",
        },
      });
      toastManager.add({ title: t("sendError"), type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setSelectedTemplate(null);
    setCustomSubject("");
    setCustomMessage("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal={modal}>
      <DialogPopup initialFocus={autoFocus} finalFocus={autoFocus} className={cn("max-w-lg", showSidePreview && "lg:max-w-5xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: customer.firstName, email: customer.email })}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className={cn(showSidePreview && "lg:grid lg:grid-cols-2 lg:items-start lg:gap-6")}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label id={templateLabelId} render={<span />}>
                  {t("selectTemplate")}
                </Label>
                <RadioGroup
                  aria-labelledby={templateLabelId}
                  className="gap-1.5"
                  value={selectedTemplate}
                  onKeyDownCapture={() => {
                    keyboardSelectionRef.current = true;
                  }}
                  onPointerDownCapture={() => {
                    keyboardSelectionRef.current = false;
                  }}
                  onValueChange={(value) => {
                    if (typeof value === "string") handleTemplateChange(value);
                  }}
                >
                  {availableTemplates.map((template) => {
                    const wasSent = sentEmails.includes(template.id);

                    return (
                      <Label
                        key={template.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl border p-3 font-normal transition-colors",
                          "hover:bg-accent/40 has-data-checked:border-primary has-data-checked:bg-primary/5",
                        )}
                      >
                        <DashboardIconTile accent={template.accent} icon={template.Icon} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-medium text-foreground text-sm">
                              {t(`templates.${template.id}.name`)}
                            </span>
                            {wasSent && (
                              <Badge size="sm" variant="success">
                                <CheckSolidIcon className="size-2.5" />
                                {t("alreadySent")}
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block text-muted-foreground text-xs">
                            {t(`templates.${template.id}.description`)}
                          </span>
                        </span>
                        <Radio data-demo-target={`email-template-${template.id}`} className="shrink-0" value={template.id} />
                      </Label>
                    );
                  })}
                </RadioGroup>
              </div>

              {selectedTemplate === "custom" && (
                <div
                  className="animate-in fade-in slide-in-from-top-2 space-y-3 duration-200"
                  ref={extraFieldsRef}
                >
                  <div className="space-y-2">
                    <Label htmlFor={subjectId}>{t("customSubject")}</Label>
                    <Input
                      id={subjectId}
                      value={customSubject}
                      onChange={(event) => setCustomSubject(event.target.value)}
                      placeholder={t("customSubjectPlaceholder", { number: reservationNumber })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={messageId}>
                      {t("customMessage")} <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id={messageId}
                      value={customMessage}
                      onChange={(event) => setCustomMessage(event.target.value)}
                      placeholder={t("customMessagePlaceholder")}
                      rows={4}
                    />
                  </div>
                </div>
              )}

              {selectedTemplate && selectedTemplate !== "custom" && (
                <div
                  className="animate-in fade-in slide-in-from-top-2 space-y-2 duration-200"
                  ref={extraFieldsRef}
                >
                  <Label htmlFor={messageId}>
                    {t("additionalMessage")}
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({tCommon("optional")})
                    </span>
                  </Label>
                  <Textarea
                    id={messageId}
                    value={customMessage}
                    onChange={(event) => setCustomMessage(event.target.value)}
                    placeholder={t("additionalMessagePlaceholder")}
                    rows={2}
                  />
                </div>
              )}

            </div>

            {/* Wide screens read the email beside the form, live, instead of
                opening it over the choices that produced it. */}
            {showSidePreview && (
              <div className="hidden lg:sticky lg:top-0 lg:block">
                <Label className="mb-2" render={<span />}>
                  {t("previewTitle")}
                </Label>
                <EmailPreview
                  context={previewContext}
                  customMessage={customMessage}
                  customSubject={customSubject}
                  frameClassName="h-[52vh] min-h-72"
                  reservationId={reservationId}
                  templateId={selectedTemplate}
                />
              </div>
            )}
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button
            className="mr-auto"
            disabled={isLoading}
            onClick={() => handleOpenChange(false)}
            variant="outline"
          >
            {tCommon("cancel")}
          </Button>
          {selectedTemplate && !showSidePreview && (
            <Button
              // A custom email with no message has nothing to render yet.
              disabled={selectedTemplate === "custom" && !customMessage.trim()}
              onClick={() => setIsPreviewOpen(true)}
              variant="outline"
            >
              <EyeIcon />
              {t("preview")}
            </Button>
          )}
          <Button disabled={readOnly || !selectedTemplate} isPending={isLoading} onClick={handleSend}>
            <SendIcon />
            {t("send")}
          </Button>
        </DialogFooter>

        {selectedTemplate && !showSidePreview && (
          <EmailPreviewDialog
            context={previewContext}
            autoFocus={autoFocus}
            modal={modal}
            customMessage={customMessage}
            customSubject={customSubject}
            customerFirstName={customer.firstName}
            onOpenChange={setIsPreviewOpen}
            open={isPreviewOpen}
            reservationId={reservationId}
            templateId={selectedTemplate}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}
