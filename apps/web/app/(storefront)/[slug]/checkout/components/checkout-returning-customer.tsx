"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useLocale, useTranslations } from "next-intl";

import { Button, InputOTP, InputOTPGroup, InputOTPSlot } from "@louez/ui";

import { getCustomerSession, sendVerificationCode, verifyCode } from "../../account/actions";
import type { CheckoutInitialCustomer } from "../checkout.types";
import { toCheckoutInitialCustomer } from "../util.checkout-customer";

interface CheckoutReturningCustomerProps {
  storeId: string;
  storeSlug: string;
  email: string;
  onVerified: (customer: CheckoutInitialCustomer) => void;
}

const CODE_LENGTH = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toErrorKey = (error: string): string => error.replace(/^errors\./, "");

/**
 * "Déjà client ?" under the email field: sends the login code, verifies it
 * inline and hands the customer back so the form prefills. Same actions and
 * limits as the account login.
 */
export const CheckoutReturningCustomer = ({
  storeId,
  storeSlug,
  email,
  onVerified,
}: CheckoutReturningCustomerProps) => {
  const t = useTranslations("storefront.checkout.returningCustomer");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: async (target: string) => {
      const result = await sendVerificationCode(storeId, target, locale === "en" ? "en" : "fr");
      if (result.error) throw new Error(result.error);
      return target;
    },
    onSuccess: (target) => {
      setSentTo(target);
      setCode("");
      setError(null);
    },
    onError: (mutationError) => setError(tErrors(toErrorKey(mutationError.message))),
  });

  const verifyMutation = useMutation({
    mutationFn: async (value: string) => {
      if (!sentTo) throw new Error("errors.invalidOrExpiredCode");
      const result = await verifyCode(storeId, sentTo, value);
      if (result.error) throw new Error(result.error);
      const session = await getCustomerSession(storeSlug);
      if (!session) throw new Error("errors.verificationError");
      return toCheckoutInitialCustomer(session.customer);
    },
    onSuccess: (customer) => {
      setSentTo(null);
      setCode("");
      onVerified(customer);
    },
    onError: (mutationError) => {
      setCode("");
      setError(tErrors(toErrorKey(mutationError.message)));
    },
  });

  const canSend = EMAIL_PATTERN.test(email.trim()) && !sendMutation.isPending;

  if (!sentTo) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">{t("prompt")}</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          disabled={!canSend}
          isPending={sendMutation.isPending}
          onClick={() => sendMutation.mutate(email.trim())}
        >
          {t("sendCode")}
        </Button>
        {error && <p className="basis-full text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
      <p className="text-sm">{t("codeSent", { email: sentTo })}</p>
      <InputOTP
        maxLength={CODE_LENGTH}
        pattern={REGEXP_ONLY_DIGITS}
        value={code}
        onChange={setCode}
        onComplete={(value) => verifyMutation.mutate(value)}
        disabled={verifyMutation.isPending}
        autoFocus
        aria-label={t("codeLabel")}
      >
        <InputOTPGroup>
          {Array.from({ length: CODE_LENGTH }, (_, index) => (
            <InputOTPSlot key={index} index={index} className="h-11 w-10 text-base" />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            setSentTo(null);
            setError(null);
          }}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          isPending={sendMutation.isPending}
          onClick={() => sendMutation.mutate(sentTo)}
        >
          {t("resend")}
        </Button>
        {verifyMutation.isPending && (
          <span className="text-xs text-muted-foreground">{t("verifying")}</span>
        )}
      </div>
    </div>
  );
};
