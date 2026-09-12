"use client";

import { useRouter } from "next/navigation";

import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  SelectItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toastManager,
} from "@louez/ui";
import { ExternalLinkIcon, InfoCircleIcon, MailIcon, PhoneCallIcon } from "@louez/ui/icons";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { useAppForm } from "@/hooks/form/form";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import { orpc } from "@/lib/orpc/react";

import { ContactPresetSection } from "./contact-preset-section";
import { ContactPreview } from "./contact-preview";
import {
  CONTACT_PHONE_FIELD_OPTIONS,
  type ContactSettingsStore,
  buildContactSettingsDefaults,
  contactSettingsFormOptions,
} from "./util.contact-settings-form";

interface ContactSettingsFormProps {
  store: ContactSettingsStore;
}

/**
 * Which channels the storefront contact page offers and where the form's
 * messages go. Phone and email channels read the store's own fields, so a
 * missing field shows a hint instead of a switch that would do nothing.
 */
export const ContactSettingsForm = ({ store }: ContactSettingsFormProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.contactSettings");
  const tErrors = useTranslations("errors");
  const { getAbsoluteUrl } = useStorefrontUrl(store.slug);

  const updateContact = useMutation({
    ...orpc.dashboard.settings.updateContact.mutationOptions(),
  });

  const form = useAppForm({
    ...contactSettingsFormOptions,
    defaultValues: buildContactSettingsDefaults(store),
    onSubmit: async ({ value }) => {
      try {
        await updateContact.mutateAsync(value);
        toastManager.add({ title: t("updated"), type: "success" });
        form.reset(value);
        router.refresh();
      } catch {
        toastManager.add({ title: tErrors("generic"), type: "error" });
      }
    },
  });

  const isDirty = useStore(form.store, (state) => state.isDirty);
  const hasPhone = Boolean(store.phone?.trim());
  const hasEmail = Boolean(store.email?.trim());

  return (
    <form.AppForm>
      <form.Form>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
          <div className="flex flex-col gap-6">
            <ContactPresetSection form={form} />

            <Card>
              <CardContent>
                <Tabs defaultValue="channels">
                  <TabsList className="mb-4">
                    <TabsTrigger value="channels">
                      <PhoneCallIcon className="size-4" />
                      {t("channels.title")}
                    </TabsTrigger>
                    <TabsTrigger value="form">
                      <MailIcon className="size-4" />
                      {t("form.title")}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="channels" className="flex flex-col gap-4">
                    <p className="text-muted-foreground text-sm">{t("channels.description")}</p>

                    {!hasPhone || !hasEmail ? (
                      <Alert>
                        <InfoCircleIcon />
                        <AlertDescription>
                          {t(
                            !hasPhone && !hasEmail
                              ? "missingBoth"
                              : !hasPhone
                                ? "missingPhone"
                                : "missingEmail",
                          )}
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    <form.AppField name="phone">
                      {(field) => (
                        <field.Switch
                          label={t("phone.label")}
                          description={
                            store.phone
                              ? t("phone.description", { phone: store.phone })
                              : t("phone.empty")
                          }
                          disabled={!hasPhone}
                        />
                      )}
                    </form.AppField>

                    <form.Subscribe selector={(state) => state.values.phone}>
                      {(phoneEnabled) => (
                        <form.AppField name="sms">
                          {(field) => (
                            <field.Switch
                              label={t("sms.label")}
                              description={t("sms.description")}
                              disabled={!hasPhone || !phoneEnabled}
                            />
                          )}
                        </form.AppField>
                      )}
                    </form.Subscribe>

                    <form.AppField name="whatsapp">
                      {(field) => (
                        <div className="flex flex-col gap-3">
                          <field.Switch
                            label={t("whatsapp.label")}
                            description={t("whatsapp.description")}
                          />
                          {field.state.value ? (
                            <form.AppField name="whatsappNumber">
                              {(numberField) => (
                                <numberField.Input
                                  label={t("whatsapp.number")}
                                  description={t("whatsapp.numberDescription")}
                                  type="tel"
                                  inputMode="tel"
                                  placeholder={store.phone ?? "+33 6 12 34 56 78"}
                                  className="sm:max-w-sm"
                                />
                              )}
                            </form.AppField>
                          ) : null}
                        </div>
                      )}
                    </form.AppField>

                    <form.AppField name="email">
                      {(field) => (
                        <field.Switch
                          label={t("email.label")}
                          description={
                            store.email
                              ? t("email.description", { email: store.email })
                              : t("email.empty")
                          }
                          disabled={!hasEmail}
                        />
                      )}
                    </form.AppField>
                  </TabsContent>

                  <TabsContent value="form" className="flex flex-col gap-4">
                    <p className="text-muted-foreground text-sm">{t("form.description")}</p>

                    <form.AppField name="form">
                      {(field) => (
                        <div className="flex flex-col gap-4">
                          <field.Switch label={t("form.label")} description={t("form.help")} />
                          {field.state.value ? (
                            <>
                              <form.AppField name="formRecipientEmail">
                                {(recipientField) => (
                                  <recipientField.Input
                                    label={t("form.recipient")}
                                    description={
                                      store.email
                                        ? t("form.recipientDescription", { email: store.email })
                                        : t("form.recipientEmpty")
                                    }
                                    type="email"
                                    inputMode="email"
                                    placeholder={store.email ?? "contact@example.com"}
                                    className="sm:max-w-sm"
                                  />
                                )}
                              </form.AppField>

                              <form.AppField name="formPhoneField">
                                {(phoneFieldField) => (
                                  <phoneFieldField.Select
                                    label={t("form.phoneField")}
                                    description={t("form.phoneFieldDescription")}
                                    className="sm:max-w-sm"
                                    items={CONTACT_PHONE_FIELD_OPTIONS.map((option) => ({
                                      value: option,
                                      label: t(`form.phoneFieldOptions.${option}`),
                                    }))}
                                  >
                                    {CONTACT_PHONE_FIELD_OPTIONS.map((option) => (
                                      <SelectItem key={option} value={option}>
                                        {t(`form.phoneFieldOptions.${option}`)}
                                      </SelectItem>
                                    ))}
                                  </phoneFieldField.Select>
                                )}
                              </form.AppField>
                            </>
                          ) : null}
                        </div>
                      )}
                    </form.AppField>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(getAbsoluteUrl("/contact"), "_blank", "noopener,noreferrer")
                }
              >
                <ExternalLinkIcon className="size-4" />
                {t("viewOnStore")}
              </Button>
            </div>
          </div>
          <ContactPreview form={form} store={store} />
        </div>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={updateContact.isPending}
          onReset={() => form.reset()}
        />
      </form.Form>
    </form.AppForm>
  );
};
