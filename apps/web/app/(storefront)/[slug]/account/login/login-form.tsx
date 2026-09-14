"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { ArrowLeftIcon, LockKeyholeIcon, MailIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { useStorefrontBasePath } from "@/contexts/store-context";
import type { LoginErrorCode } from "@/lib/customer-auth/util.account-redirect";
import { resolveStorefrontHref } from "@/lib/util.storefront-href";

import { LoginCodeStep } from "./login-code-step";
import { LoginEmailStep } from "./login-email-step";

interface LoginFormProps {
  storeSlug: string;
  storeName: string;
  /** Whitelisted by the page; where the customer lands once signed in. */
  redirectPath: string;
  /** From `?error=`: why the customer was sent here (expired link…). */
  errorCode: LoginErrorCode | null;
}

/** Two steps, one card: the email step hands the address to the code step. */
export const LoginForm = ({ storeSlug, storeName, redirectPath, errorCode }: LoginFormProps) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("storefront");
  const basePath = useStorefrontBasePath() ?? "";
  const [email, setEmail] = useState<string | null>(null);

  const handleVerified = () => {
    queryClient.clear();
    router.push(resolveStorefrontHref(basePath, redirectPath));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <StorefrontLink
        href="/catalog"
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        {t("account.viewCatalog")}
      </StorefrontLink>
      <div className="flex flex-col gap-6 rounded-3xl border bg-card p-6 shadow-card sm:gap-8 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {email ? (
              <MailIcon aria-hidden className="size-5" />
            ) : (
              <LockKeyholeIcon aria-hidden className="size-5" />
            )}
          </span>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{storeName}</p>
            <p className="text-muted-foreground">{t("footer.account")}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {t("account.loginTitle")}
          </h1>
          <p className="text-pretty break-words text-sm leading-relaxed text-muted-foreground">
            {email ? t("account.codeLine", { email }) : t("account.loginLine")}
          </p>
        </div>

        {email ? (
          <LoginCodeStep
            storeSlug={storeSlug}
            email={email}
            onVerified={handleVerified}
            onChangeEmail={() => setEmail(null)}
          />
        ) : (
          <LoginEmailStep storeSlug={storeSlug} errorCode={errorCode} onCodeSent={setEmail} />
        )}

        <p className="border-t pt-5 text-center text-xs leading-relaxed text-muted-foreground">
          {t("account.securityNote")}
        </p>
      </div>
    </div>
  );
};
