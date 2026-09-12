"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { AlertCircleIcon, CheckCircle2Icon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import type { StoreContactPhoneField } from "@louez/types";
import { Alert, AlertDescription, Button } from "@louez/ui";

import {
  sendContactMessage,
  type SendContactMessageError,
} from "@/app/(storefront)/[slug]/contact/actions";
import {
  buildContactMessageSchema,
  CONTACT_MESSAGE_MAX_LENGTH,
  type ContactMessageValues,
} from "@/app/(storefront)/[slug]/contact/validator.contact";
import { useAppForm } from "@/hooks/form/form";

interface ContactFormProps {
  storeSlug: string;
  storeName: string;
  phoneField: StoreContactPhoneField;
}

const EMPTY_VALUES: ContactMessageValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  message: "",
  website: "",
};

const FIELD_CLASS_NAME = "h-12 items-center text-base [&_input]:h-full [&_input]:leading-normal";

class SendContactMessageFailure extends Error {
  code: SendContactMessageError;

  constructor(code: SendContactMessageError) {
    super(code);
    this.code = code;
  }
}

/**
 * Name, email, an optional phone and the message; the honeypot stays out of
 * sight. Once sent, the form gives way to a confirmation so a double tap
 * cannot send twice.
 */
export const ContactForm = ({ storeSlug, storeName, phoneField }: ContactFormProps) => {
  const t = useTranslations("storefront.contact");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: async (values: ContactMessageValues) => {
      const result = await sendContactMessage({ storeSlug, values });
      if (!result.ok) throw new SendContactMessageFailure(result.error);
    },
    onSuccess: () => setSent(true),
  });

  const form = useAppForm({
    defaultValues: EMPTY_VALUES,
    validators: { onSubmit: buildContactMessageSchema(phoneField, (key) => t(`errors.${key}`)) },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: async ({ value }) => {
      await send.mutateAsync(value).catch(() => undefined);
    },
  });

  if (sent) {
    return (
      <div
        role="status"
        className="flex flex-col items-start gap-3 rounded-2xl border bg-background p-6"
      >
        <CheckCircle2Icon aria-hidden className="size-8 text-primary" />
        <p className="text-lg font-semibold">{t("sentTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("sentDescription", { name: storeName })}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.reset();
            send.reset();
            setSent(false);
          }}
        >
          {t("sendAnother")}
        </Button>
      </div>
    );
  }

  const inlineError = send.error
    ? send.error instanceof SendContactMessageFailure
      ? t(`errors.${send.error.code}`)
      : tErrors("generic")
    : null;

  const phoneLabel =
    phoneField === "required" ? t("phone") : `${t("phone")} (${tCommon("optional")})`;

  return (
    <form.AppForm>
      <form.Form formName="storefront-contact" className="flex flex-col gap-4" noValidate>
        {inlineError ? (
          <Alert variant="error">
            <AlertCircleIcon />
            <AlertDescription>{inlineError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <form.AppField name="firstName">
            {(field) => (
              <field.Input
                label={t("firstName")}
                autoComplete="given-name"
                className={FIELD_CLASS_NAME}
              />
            )}
          </form.AppField>
          <form.AppField name="lastName">
            {(field) => (
              <field.Input
                label={t("lastName")}
                autoComplete="family-name"
                className={FIELD_CLASS_NAME}
              />
            )}
          </form.AppField>
        </div>

        <form.AppField name="email">
          {(field) => (
            <field.Input
              label={t("email")}
              type="email"
              inputMode="email"
              autoComplete="email"
              className={FIELD_CLASS_NAME}
            />
          )}
        </form.AppField>

        {phoneField === "hidden" ? null : (
          <form.AppField name="phone">
            {(field) => (
              <field.Input
                label={phoneLabel}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className={FIELD_CLASS_NAME}
              />
            )}
          </form.AppField>
        )}

        <form.AppField name="message">
          {(field) => (
            <field.Textarea
              label={t("message")}
              rows={6}
              maxLength={CONTACT_MESSAGE_MAX_LENGTH}
              placeholder={t("messagePlaceholder")}
              className="text-base"
            />
          )}
        </form.AppField>

        {/* Honeypot: visually and semantically hidden; bots fill it, people never see it. */}
        <form.Field name="website">
          {(field) => (
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="contact-website">Website</label>
              <input
                id="contact-website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </div>
          )}
        </form.Field>

        <p className="text-xs text-muted-foreground">{t("privacyNote", { name: storeName })}</p>

        <Button
          type="submit"
          size="xl"
          className="h-12 w-full sm:w-auto sm:self-start"
          isPending={send.isPending}
          pendingContent={t("sending")}
        >
          {t("send")}
          <SendIcon data-slot="icon" />
        </Button>
      </form.Form>
    </form.AppForm>
  );
};
