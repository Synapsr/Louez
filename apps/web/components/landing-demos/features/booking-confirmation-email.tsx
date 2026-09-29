"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { render } from "@react-email/render";
import { Skeleton } from "@louez/ui";
import type { Locale } from "@/i18n/config";
import { composeConfirmationPreview } from "@/lib/document-previews/compose-confirmation-preview";
import { createInertEmailDocument } from "@/lib/document-previews/util.inert-email-document";
import { createDemoConfirmationProps } from "@/lib/landing-demos/customer-messages";
import type { DemoBooking } from "@/lib/landing-demos/fixtures";
import { getMessageDemoText } from "@/lib/landing-demos/text.messages";

export const BookingConfirmationEmail = ({
  booking,
  locale,
}: {
  booking: DemoBooking;
  locale: Locale;
}) => {
  const t = useTranslations("dashboard.reservations.emailModal");
  const text = getMessageDemoText(locale);
  const [result, setResult] = useState<{ subject: string; html: string } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const composed = composeConfirmationPreview(
      createDemoConfirmationProps(booking, booking.period, locale),
    );
    void render(composed.element)
      .then((html) => {
        if (active) setResult({ subject: composed.subject, html: createInertEmailDocument(html) });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [booking, locale]);

  return (
    <div
      className="flex h-svh flex-col gap-4 bg-muted/30 p-6"
      data-demo-target="booking-confirmation-email"
    >
      {error ? (
        <p className="text-destructive">{t("previewError")}</p>
      ) : result ? (
        <>
          <dl className="mx-auto w-full max-w-3xl space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">{text.sender}</dt>
              <dd>Maison du Vélo &lt;bonjour@maisonduvelo.example&gt;</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("previewSubject")}</dt>
              <dd className="font-medium">{result.subject}</dd>
            </div>
          </dl>
          <iframe
            className="mx-auto min-h-0 w-full max-w-3xl flex-1 rounded-lg border bg-white"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={result.html}
            title={t("previewTitle")}
          />
        </>
      ) : (
        <Skeleton className="mx-auto h-full w-full max-w-3xl rounded-lg" />
      )}
    </div>
  );
};
