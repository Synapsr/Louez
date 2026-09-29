"use client";
import { useEffect, useState } from "react";
import { render } from "@react-email/render";
import { useTranslations } from "next-intl";
import { InstantAccessEmail } from "@/lib/email/templates/instant-access";
import { getEmailTranslations } from "@/lib/email/i18n";
import type { Locale } from "@/i18n/config";
import {
  createDemoPortalEmail,
  PORTAL_STORE,
  type DemoPortalReservation,
} from "@/lib/landing-demos/portal";
import { createDemoPortalEmailDocument } from "@/lib/landing-demos/portal-email";

/** A sandboxed real email with a hit area measured from its own CTA, without email-client chrome. */
export const PortalAccessEmail = ({
  reservation,
  locale,
  onOpen,
}: {
  reservation: DemoPortalReservation;
  locale: Locale;
  onOpen: () => void;
}) => {
  const tErrors = useTranslations("errors");
  const [html, setHtml] = useState("");
  const [layout, setLayout] = useState<{
    height: number;
    top: number;
    left: number;
    width: number;
    buttonHeight: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const email = getEmailTranslations(locale);
  const subject = email.instantAccess.subject.replace("{number}", reservation.number);
  useEffect(() => {
    let active = true;
    void render(<InstantAccessEmail {...createDemoPortalEmail(reservation, locale)} />)
      .then((document) => {
        if (active) setHtml(createDemoPortalEmailDocument(document));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [reservation, locale]);
  return (
    <div className="h-dvh overflow-y-auto" data-demo-target="portal-scroll">
      <div className="border-b bg-background px-4 py-3">
        <p className="text-sm font-medium">{subject}</p>
        <p className="text-xs text-muted-foreground">
          {PORTAL_STORE.storeName} &lt;{PORTAL_STORE.email}&gt;
        </p>
      </div>
      <div className="relative">
        {html ? (
          <iframe
            title={subject}
            srcDoc={html}
            sandbox="allow-same-origin"
            className="w-full border-0"
            tabIndex={-1}
            style={{ height: layout?.height ?? 1000 }}
            onLoad={(event) => {
              const document = event.currentTarget.contentDocument;
              const button = document?.querySelector("[data-portal-email-action]");
              if (!button || !document) return;
              const rect = button.getBoundingClientRect();
              setLayout({
                height: document.documentElement.scrollHeight,
                top: rect.top,
                left: rect.left,
                width: rect.width,
                buttonHeight: rect.height,
              });
            }}
          />
        ) : null}
        {layout ? (
          <button
            type="button"
            data-demo-target="portal-email-access"
            aria-label={email.common.viewReservation}
            className="absolute cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              top: layout.top,
              left: layout.left,
              width: layout.width,
              height: layout.buttonHeight,
            }}
            onClick={onOpen}
          />
        ) : null}
        {failed ? (
          <p role="alert" className="p-4 text-sm">
            {tErrors("generic")}
          </p>
        ) : null}
      </div>
    </div>
  );
};
