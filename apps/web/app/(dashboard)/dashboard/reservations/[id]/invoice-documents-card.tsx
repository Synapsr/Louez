"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@louez/ui";
import { cn, formatCurrency } from "@louez/utils";

import {
  generateInvoiceForReservation,
  recheckInvoiceTransmission,
} from "@/lib/invoicing/actions";

type TransmissionStatus =
  | "not_applicable"
  | "pending"
  | "sent"
  | "validated"
  | "rejected"
  | "failed";

export interface ReservationInvoiceDocument {
  id: string;
  number: string;
  type: "invoice" | "credit_note";
  issueDate: string;
  totalInclTax: string;
  currency: string;
  transmissionStatus: TransmissionStatus;
}

const TRANSMISSION_BADGE_VARIANTS = {
  not_applicable: "expired",
  pending: "pending",
  sent: "progress",
  validated: "success",
  rejected: "failed",
  failed: "failed",
} satisfies Record<TransmissionStatus, "expired" | "pending" | "progress" | "success" | "failed">;

interface InvoiceDocumentsCardProps {
  reservationId: string;
  invoices: ReservationInvoiceDocument[];
  canGenerate: boolean;
}

export const InvoiceDocumentsCard = ({
  reservationId,
  invoices,
  canGenerate,
}: InvoiceDocumentsCardProps) => {
  const t = useTranslations("dashboard.reservations.invoiceDocuments");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<"success" | "error" | null>(null);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);

  const handleGenerate = () => {
    setFeedback(null);
    startTransition(async () => {
      const result = await generateInvoiceForReservation(reservationId);
      if (result.status === "error") {
        setFeedback("error");
        return;
      }
      setFeedback("success");
      router.refresh();
    });
  };

  const handleRecheck = (invoiceId: string) => {
    setFeedback(null);
    setRecheckingId(invoiceId);
    startTransition(async () => {
      try {
        const result = await recheckInvoiceTransmission(invoiceId);
        if (result.status === "error") setFeedback("error");
        else router.refresh();
      } finally {
        setRecheckingId(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            {t("title")}
          </CardTitle>
          {canGenerate && (
            <Button size="sm" onClick={handleGenerate} isPending={isPending}>
              {t("generate")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {feedback && (
          <p
            className={
              feedback === "success"
                ? "text-emerald-600 text-sm dark:text-emerald-400"
                : "text-destructive text-sm"
            }
          >
            {t(feedback === "success" ? "generationSuccess" : "generationError")}
          </p>
        )}

        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <div key={invoice.id} className="group space-y-2 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{invoice.number}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`types.${invoice.type}`)}
                      {" • "}
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      }).format(new Date(`${invoice.issueDate}T12:00:00Z`))}
                    </p>
                  </div>
                  <p className="shrink-0 font-medium">
                    {formatCurrency(Number(invoice.totalInclTax), invoice.currency)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Badge variant={TRANSMISSION_BADGE_VARIANTS[invoice.transmissionStatus]}>
                      {t(`transmission.${invoice.transmissionStatus}`)}
                    </Badge>
                    {invoice.transmissionStatus !== "not_applicable" && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("recheck")}
                        title={t("recheck")}
                        disabled={recheckingId !== null}
                        onClick={() => handleRecheck(invoice.id)}
                        className={cn(
                          "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                          recheckingId === invoice.id && "opacity-100",
                        )}
                      >
                        <RefreshCw
                          data-slot="icon"
                          className={cn(recheckingId === invoice.id && "animate-spin")}
                        />
                      </Button>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <a
                        href={`/api/reservations/${reservationId}/invoices/${invoice.id}`}
                        aria-label={t("downloadNamed", { number: invoice.number })}
                      />
                    }
                  >
                    <Download data-slot="icon" />
                    {t("download")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
