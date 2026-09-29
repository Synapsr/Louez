"use client";

import { useTranslations } from "next-intl";
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { Badge, toastManager } from "@louez/ui";
import { MailIcon, ShieldSolidIcon, TeamIcon, UserPlusSolidIcon } from "@louez/ui/icons";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { useAppForm } from "@/hooks/form/form";

import { addTeamMember } from "./actions";
import { TeamLimitNotice } from "./team-limit-notice";
import type { TeamLimits } from "./team-types";

interface TeamInviteCardProps {
  limits: TeamLimits | null;
  readOnly?: boolean;
  onInvite?: (email: string) => void | Promise<void>;
}

export const TeamInviteCard = ({ limits, readOnly = false, onInvite }: TeamInviteCardProps) => {
  const t = useTranslations("dashboard.team");
  const tErrors = useTranslations("errors");
  const tValidation = useTranslations("validation");

  const hasNoCollaboratorAccess = limits?.limit === 0;
  const isAtLimit = Boolean(limits && !limits.allowed && limits.limit !== null && limits.limit > 0);
  const showUsageBadge = Boolean(limits && limits.limit !== null && limits.limit > 0);

  /** Server actions answer with a translation key, in either namespace. */
  const resolveErrorMessage = (error: unknown) => {
    const code = error instanceof Error ? error.message : "";
    const teamKey = code.replace("dashboard.team.", "");
    if (t.has(teamKey)) return t(teamKey);

    const errorKey = code.replace("errors.", "");
    if (tErrors.has(errorKey)) return tErrors(errorKey);

    return tErrors("generic");
  };

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      if (onInvite) {
        await onInvite(email.toLowerCase().trim());
        return null;
      }
      if (readOnly) return null;

      const formData = new FormData();
      formData.append("email", email.toLowerCase().trim());

      const result = await addTeamMember(formData);
      if (result.error) {
        throw new Error(result.error);
      }

      return result;
    },
  });

  const form = useAppForm({
    defaultValues: { email: "" },
    validators: { onSubmit: z.object({ email: z.email(tValidation("email")) }) },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: async ({ value }) => {
      try {
        const result = await inviteMutation.mutateAsync(value.email);

        if (!result) {
          form.reset();
          return;
        }

        if (result.invitationUrl) {
          const copied = await navigator.clipboard
            ?.writeText(result.invitationUrl)
            .then(() => true)
            .catch(() => false);
          toastManager.add({
            title: copied ? t("invitationLinkCopied") : result.invitationUrl,
            type: "success",
          });
          form.reset();
          return;
        }

        toastManager.add({
          title: result.type === "invited" ? t("invitationSent") : t("memberAdded"),
          type: "success",
        });
        form.reset();
      } catch (error) {
        if (readOnly) return;
        toastManager.add({ title: resolveErrorMessage(error), type: "error" });
      }
    },
  });

  return (
    <DashboardSectionCard
      title={t("addMember")}
      description={t("addMemberDescription")}
      icon={UserPlusSolidIcon}
      accent="primary"
      action={
        showUsageBadge && (
          <Badge variant={limits?.allowed ? "progress" : "review"} className="tabular-nums">
            {t("limitBadge", { current: limits?.current ?? 0, limit: limits?.limit ?? 0 })}
          </Badge>
        )
      }
    >
      {hasNoCollaboratorAccess ? (
        <TeamLimitNotice
          icon={ShieldSolidIcon}
          accent="primary"
          title={t("featureNotAvailable")}
          description={t("featureNotAvailableDescription")}
          actionLabel={t("upgradeToPro")}
          className="bg-muted/40"
        />
      ) : isAtLimit ? (
        <TeamLimitNotice
          icon={TeamIcon}
          accent="pending"
          title={t("limitReachedTitle")}
          description={t("limitReachedDescription", {
            current: limits?.current ?? 0,
            limit: limits?.limit ?? 0,
          })}
          actionLabel={t("upgradeForMore")}
          className="bg-badge-pending-background/60 ring-badge-pending-foreground/15 ring-1 ring-inset"
        />
      ) : (
        <form.AppForm>
          <form.Form
            className="space-y-3"
            formName="team-invite"
            {...(readOnly ? {
              // Local demos must also bypass the form wrapper's remote validation logging.
              onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              },
            } : {})}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <form.AppField name="email">
                  {(field) => (
                    <field.Input
                      data-demo-target="team-invite-email"
                      type="email"
                      autoFocus={false}
                      disabled={readOnly && !onInvite}
                      placeholder={t("emailPlaceholder")}
                      aria-label={t("addMember")}
                    />
                  )}
                </form.AppField>
              </div>
              <form.SubscribeButton
                data-demo-target="team-invite-submit"
                disabled={readOnly && !onInvite}
                className="w-full sm:w-auto"
              >
                <MailIcon />
                {t("invite")}
              </form.SubscribeButton>
            </div>
            <p className="text-muted-foreground text-sm">{t("addMemberHint")}</p>
          </form.Form>
        </form.AppForm>
      )}
    </DashboardSectionCard>
  );
};
