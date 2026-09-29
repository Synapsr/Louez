import { format } from "date-fns";
import { getTranslations } from "next-intl/server";

import { Badge } from "@louez/ui";
import { KeyIcon, MailIcon, MonitorIcon } from "@louez/ui/icons";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { GoogleIcon } from "@/components/shared/google-icon";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";

import { ChangePasswordDialog } from "./change-password-dialog";
import { LinkGoogleButton } from "./link-google-button";
import { RemovePasswordDialog } from "./remove-password-dialog";
import { SetPasswordDialog } from "./set-password-dialog";
import { SignInMethodRow } from "./sign-in-method-row";

interface SignInMethodsCardProps {
  email: string;
  /** False without a mail transport (self-host without SMTP): no code can be sent. */
  emailCodeAvailable: boolean;
  /** Null when Google OAuth is not configured on this instance: the row is hidden. */
  google: { linked: boolean } | null;
  /** When the password was set or last changed; null without one. */
  passwordSetAt: Date | null;
  /** False where the password is the only way in (see `canRemovePassword`). */
  canRemovePassword: boolean;
  activeSessionCount: number;
}

/** "Sign-in" card of the account page: one row per method, real data only. */
export const SignInMethodsCard = async ({
  email,
  emailCodeAvailable,
  google,
  passwordSetAt,
  canRemovePassword,
  activeSessionCount,
}: SignInMethodsCardProps) => {
  const t = await getTranslations("dashboard.settings.accountSettings");
  const { dateFns: dateLocale } = await getRequestFormatLocale();

  return (
    <DashboardSectionCard
      title={t("signIn.title")}
      description={t("signIn.description")}
      icon={KeyIcon}
    >
      <ul className="divide-y">
        <SignInMethodRow icon={MailIcon} title={t("signIn.emailCode")} status={email}>
          <Badge variant={emailCodeAvailable ? "success" : "expired"}>
            {emailCodeAvailable ? t("signIn.alwaysActive") : t("signIn.unavailable")}
          </Badge>
        </SignInMethodRow>

        {google && (
          <SignInMethodRow
            icon={GoogleIcon}
            title={t("signIn.google")}
            status={google.linked ? t("signIn.linked") : t("signIn.notLinked")}
          >
            {google.linked ? <Badge variant="success">{t("active")}</Badge> : <LinkGoogleButton />}
          </SignInMethodRow>
        )}

        <SignInMethodRow
          icon={KeyIcon}
          title={t("signIn.password")}
          status={
            passwordSetAt
              ? t("signIn.passwordSetOn", {
                  date: format(passwordSetAt, "d MMM yyyy", { locale: dateLocale }),
                })
              : t("signIn.passwordNotSet")
          }
        >
          {passwordSetAt ? (
            <>
              <ChangePasswordDialog />
              {canRemovePassword && <RemovePasswordDialog />}
            </>
          ) : (
            <SetPasswordDialog />
          )}
        </SignInMethodRow>

        <SignInMethodRow
          icon={MonitorIcon}
          title={t("activeSessions")}
          status={t("sessionCount", { count: activeSessionCount })}
        />
      </ul>
    </DashboardSectionCard>
  );
};
