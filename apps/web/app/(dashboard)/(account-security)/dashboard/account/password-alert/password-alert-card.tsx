"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import { Button, Card, CardContent, CardHeader, CardTitle } from "@louez/ui";
import { ShieldCheckIcon } from "@louez/ui/icons";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

import { useRevokePasswordAccess } from "./use-revoke-password-access";

interface PasswordAlertCardProps {
  email: string;
  /** False where the password is the only way in: it cannot be removed there. */
  available: boolean;
}

export const PasswordAlertCard = ({ email, available }: PasswordAlertCardProps) => {
  const t = useTranslations("dashboard.settings.accountSettings.passwordAlert");
  const { revoke, isPending, isDone, error } = useRevokePasswordAccess();

  if (isDone) {
    return (
      <Card className="w-full">
        <CardHeader className="flex flex-row items-center gap-3">
          <DashboardIconTile icon={ShieldCheckIcon} accent="success" />
          <CardTitle>{t("doneTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground text-sm">{t("doneDescription")}</p>
          <Button className="w-full" render={<Link href="/login" />}>
            {t("signInAgain")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-muted-foreground text-sm">{t("description", { email })}</p>
        {available ? (
          <ul className="list-disc space-y-1 ps-5 text-sm">
            <li>{t("effectPassword")}</li>
            <li>{t("effectSessions")}</li>
            <li>{t("effectSignIn")}</li>
          </ul>
        ) : (
          <p className="text-sm">{t("unavailable")}</p>
        )}
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="w-full sm:w-auto"
            variant="destructive"
            isPending={isPending}
            disabled={!available}
            onClick={revoke}
          >
            {t("confirm")}
          </Button>
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            disabled={isPending}
            render={<Link href="/dashboard/account" />}
          >
            {t("itWasMe")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
