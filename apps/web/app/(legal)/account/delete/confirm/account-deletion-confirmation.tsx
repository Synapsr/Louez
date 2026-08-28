"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";

import {
  ACCOUNT_DELETION_REASON_HEADER,
  parseAccountDeletionReason,
  type AccountDeletionReason,
} from "@louez/auth/account-deletion";
import { authClient } from "@louez/auth/client";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@louez/ui";

import { clearAccountDeletionBrowserState } from "@/lib/account-deletion/browser-cleanup";

const TOKEN_STORAGE_KEY = "louez-account-deletion-token";
const REASON_STORAGE_KEY = "louez-account-deletion-reason";
const deletionTokenSchema = z.string().regex(/^[a-z0-9]{32}$/);

interface AccountDeletionConfirmationProps {
  isAuthenticated: boolean;
}

export const AccountDeletionConfirmation = ({
  isAuthenticated,
}: AccountDeletionConfirmationProps) => {
  const t = useTranslations("dashboard.settings.accountSettings.accountDeletion");
  const [token, setToken] = useState<string | null>(null);
  const [reason, setReason] = useState<AccountDeletionReason | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = fragment.get("token");
    const fragmentReason = parseAccountDeletionReason(fragment.get("reason"));
    const storedToken = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    const storedReason = parseAccountDeletionReason(
      window.sessionStorage.getItem(REASON_STORAGE_KEY),
    );
    const resolvedToken = fragmentToken ?? storedToken;
    const resolvedReason = fragmentToken ? fragmentReason : storedReason;
    const tokenResult = deletionTokenSchema.safeParse(resolvedToken);

    window.history.replaceState(null, "", window.location.pathname);
    if (!tokenResult.success) {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(REASON_STORAGE_KEY);
      setError(t("invalidLink"));
      return;
    }

    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, tokenResult.data);
    if (resolvedReason) {
      window.sessionStorage.setItem(REASON_STORAGE_KEY, resolvedReason);
    } else {
      window.sessionStorage.removeItem(REASON_STORAGE_KEY);
    }
    setToken(tokenResult.data);
    setReason(resolvedReason);
    if (!isAuthenticated) {
      window.location.replace("/login?callbackUrl=%2Faccount%2Fdelete%2Fconfirm");
    }
  }, [isAuthenticated, t]);

  const confirmDeletion = async () => {
    if (!token || isPending) return;

    setError(null);
    setIsPending(true);
    try {
      const result = await authClient.deleteUser(
        { token },
        reason ? { headers: { [ACCOUNT_DELETION_REASON_HEADER]: reason } } : {},
      );
      if (result.error) {
        setError(result.error.message || t("genericError"));
        return;
      }

      clearAccountDeletionBrowserState();
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(REASON_STORAGE_KEY);
      await fetch("/api/account-deletion/clear-store-cookie", { method: "POST" }).catch(
        () => undefined,
      );
      window.location.replace("/account-deleted");
    } catch {
      setError(t("genericError"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-12">
      <Card className="w-full border-destructive/40">
        <CardHeader>
          <CardTitle>{t("confirmPageTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">{t("confirmPageDescription")}</p>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button
            className="w-full"
            variant="destructive"
            isPending={isPending}
            disabled={!token || !isAuthenticated}
            onClick={confirmDeletion}
          >
            {t("confirmFinal")}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
};
