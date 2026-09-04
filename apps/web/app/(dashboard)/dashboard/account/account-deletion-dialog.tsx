"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";

import {
  ACCOUNT_DELETION_REASON_HEADER,
  accountDeletionReasonSchema,
  accountDeletionReasons,
  parseAccountDeletionReason,
  type AccountDeletionReason,
} from "@louez/auth/account-deletion";
import { authClient } from "@louez/auth/client";
import {
  Button,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  Label,
  Radio,
  RadioGroup,
} from "@louez/ui";

import { useAppForm } from "@/hooks/form/form";
import type { AccountDeletionPreview } from "@/lib/account-deletion/account-deletion";
import { clearAccountDeletionBrowserState } from "@/lib/account-deletion/browser-cleanup";

interface AccountDeletionDialogProps {
  preview: AccountDeletionPreview;
  verification: "email" | "password";
}

interface AccountDeletionFormValues {
  reason: AccountDeletionReason | "";
  confirmation: string;
  password: string;
}

const accountDeletionDefaultValues: AccountDeletionFormValues = {
  reason: "",
  confirmation: "",
  password: "",
};

const reasonLabelKeys = {
  too_expensive: "accountDeletion.reasons.tooExpensive",
  missing_features: "accountDeletion.reasons.missingFeatures",
  difficult_to_use: "accountDeletion.reasons.difficultToUse",
  no_longer_needed: "accountDeletion.reasons.noLongerNeeded",
  switched_service: "accountDeletion.reasons.switchedService",
  technical_issues: "accountDeletion.reasons.technicalIssues",
  privacy_concerns: "accountDeletion.reasons.privacyConcerns",
  other: "accountDeletion.reasons.other",
} satisfies Record<AccountDeletionReason, string>;

export const AccountDeletionDialog = ({ preview, verification }: AccountDeletionDialogProps) => {
  const t = useTranslations("dashboard.settings.accountSettings");
  const [step, setStep] = useState<"reason" | "confirmation">("reason");
  const [rootError, setRootError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        reason: accountDeletionReasonSchema.or(z.literal("")),
        confirmation: z
          .string()
          .refine(
            (value) =>
              preview.status === "ready" &&
              value.trim().toLowerCase() === preview.email.trim().toLowerCase(),
            t("accountDeletion.confirmationMismatch"),
          ),
        password:
          verification === "password"
            ? z.string().min(1, t("accountDeletion.passwordRequired"))
            : z.string(),
      }),
    [preview, t, verification],
  );

  const deletionMutation = useMutation({
    mutationFn: async (value: AccountDeletionFormValues) => {
      const reason = parseAccountDeletionReason(value.reason);
      const result = await authClient.deleteUser(
        {
          callbackURL: "/account-deleted",
          ...(verification === "password" ? { password: value.password } : {}),
        },
        reason ? { headers: { [ACCOUNT_DELETION_REASON_HEADER]: reason } } : {},
      );

      if (result.error) {
        throw new Error(result.error.message || t("accountDeletion.genericError"));
      }
      if (verification === "password") {
        clearAccountDeletionBrowserState();
      }
    },
  });

  const form = useAppForm({
    defaultValues: accountDeletionDefaultValues,
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      try {
        await deletionMutation.mutateAsync(value);
        if (verification === "email") {
          setEmailSent(true);
          return;
        }

        await fetch("/api/account-deletion/clear-store-cookie", { method: "POST" }).catch(
          () => undefined,
        );
        window.location.assign("/account-deleted");
      } catch (error) {
        setRootError(
          error instanceof Error && error.message
            ? error.message
            : t("accountDeletion.genericError"),
        );
      }
    },
  });

  const reset = () => {
    form.reset();
    setStep("reason");
    setRootError(null);
    setEmailSent(false);
  };

  const title =
    preview.status === "blocked"
      ? t("accountDeletion.blockedTitle")
      : step === "reason"
        ? t("accountDeletion.reasonTitle")
        : t("accountDeletion.title");
  const description =
    preview.status === "blocked"
      ? t("accountDeletion.blockedDescription")
      : step === "reason"
        ? t("accountDeletion.reasonDescription")
        : t("accountDeletion.description");

  return (
    <Dialog onOpenChange={(open) => !open && reset()}>
      <DialogTrigger render={<Button variant="destructive" />}>{t("deleteAccount")}</DialogTrigger>
      <DialogPopup showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {preview.status === "blocked" ? (
          <>
            <DialogPanel className="space-y-4">
              <ul className="list-disc space-y-2 ps-5 text-sm">
                {preview.stores.map((store) => (
                  <li key={store.id}>
                    {t("accountDeletion.blockedStore", {
                      count: store.otherMemberCount,
                      name: store.name,
                    })}
                  </li>
                ))}
              </ul>
            </DialogPanel>
            <DialogFooter variant="bare">
              <DialogClose render={<Button autoFocus variant="outline" />}>
                {t("accountDeletion.close")}
              </DialogClose>
            </DialogFooter>
          </>
        ) : emailSent ? (
          <>
            <DialogPanel className="space-y-2">
              <p className="font-medium">{t("accountDeletion.emailSentTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("accountDeletion.emailSentDescription", { email: preview.email })}
              </p>
            </DialogPanel>
            <DialogFooter variant="bare">
              <DialogClose render={<Button autoFocus variant="outline" />}>
                {t("accountDeletion.close")}
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form.AppForm>
            <form.Form className="contents" formName="account-deletion">
              {step === "reason" ? (
                <DialogPanel>
                  <form.Field name="reason">
                    {(field) => (
                      <RadioGroup
                        aria-label={t("accountDeletion.reasonTitle")}
                        value={field.state.value}
                        onValueChange={(value) => {
                          field.handleChange(parseAccountDeletionReason(value) ?? "");
                        }}
                      >
                        {accountDeletionReasons.map((reason) => (
                          <Label
                            key={reason}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50"
                          >
                            <Radio value={reason} />
                            <span className="text-sm">{t(reasonLabelKeys[reason])}</span>
                          </Label>
                        ))}
                      </RadioGroup>
                    )}
                  </form.Field>
                </DialogPanel>
              ) : (
                <DialogPanel className="space-y-5">
                  <div className="space-y-2 text-sm">
                    {preview.stores.length > 0 && (
                      <div>
                        <p className="font-medium">{t("accountDeletion.storesDeleted")}</p>
                        <ul className="mt-1 list-disc ps-5 text-muted-foreground">
                          {preview.stores.map((store) => (
                            <li key={store.id}>{store.name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {preview.membershipsToLeave > 0 && (
                      <p>
                        {t("accountDeletion.membershipsLeft", {
                          count: preview.membershipsToLeave,
                        })}
                      </p>
                    )}
                    {preview.businessDocumentsToDelete > 0 && (
                      <p className="text-destructive">
                        {t("accountDeletion.businessDocumentsDeleted", {
                          count: preview.businessDocumentsToDelete,
                        })}
                      </p>
                    )}
                    {preview.legalRecordsToRetain > 0 && (
                      <p className="text-muted-foreground">
                        {t("accountDeletion.legalRetention", {
                          count: preview.legalRecordsToRetain,
                        })}
                      </p>
                    )}
                  </div>

                  <form.AppField name="confirmation">
                    {(field) => (
                      <field.Input
                        label={t("accountDeletion.confirmationLabel", {
                          email: preview.email,
                        })}
                        autoComplete="off"
                      />
                    )}
                  </form.AppField>

                  {verification === "password" && (
                    <form.AppField name="password">
                      {(field) => (
                        <field.Input
                          label={t("accountDeletion.passwordLabel")}
                          type="password"
                          autoComplete="current-password"
                        />
                      )}
                    </form.AppField>
                  )}

                  {rootError && (
                    <p className="text-sm text-destructive" role="alert">
                      {rootError}
                    </p>
                  )}
                </DialogPanel>
              )}

              <DialogFooter>
                {step === "reason" ? (
                  <>
                    <DialogClose render={<Button type="button" variant="outline" />}>
                      {t("accountDeletion.cancel")}
                    </DialogClose>
                    <Button type="button" onClick={() => setStep("confirmation")}>
                      {t("accountDeletion.continue")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={deletionMutation.isPending}
                      onClick={() => setStep("reason")}
                    >
                      {t("accountDeletion.back")}
                    </Button>
                    <DialogClose
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          disabled={deletionMutation.isPending}
                        />
                      }
                    >
                      {t("accountDeletion.cancel")}
                    </DialogClose>
                    <form.SubscribeButton variant="destructive">
                      {verification === "email"
                        ? t("accountDeletion.sendConfirmation")
                        : t("accountDeletion.deleteNow")}
                    </form.SubscribeButton>
                  </>
                )}
              </DialogFooter>
            </form.Form>
          </form.AppForm>
        )}
      </DialogPopup>
    </Dialog>
  );
};
