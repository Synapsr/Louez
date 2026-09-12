import { formOptions, revalidateLogic } from "@tanstack/react-form";

import type {
  StoreContactLayout,
  StoreContactPhoneField,
  StoreContactPrimaryChannel,
  StoreSettings,
} from "@louez/types";
import { updateStoreContactInputSchema } from "@louez/validations";

import { resolveStoreContactSettings } from "@/lib/storefront/util.store-contact";

export interface ContactSettingsStore {
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  settings: StoreSettings | null;
}

/**
 * What the inputs hold: strings where the API takes `string | null`. The
 * schema's transforms turn blanks into nulls on the way in, so the values
 * are sent as they are.
 */
export interface ContactSettingsFormValues {
  layout: StoreContactLayout;
  primaryChannel: StoreContactPrimaryChannel;
  phone: boolean;
  sms: boolean;
  whatsapp: boolean;
  whatsappNumber: string;
  email: boolean;
  form: boolean;
  formRecipientEmail: string;
  formPhoneField: StoreContactPhoneField;
  intro: string;
}

export const CONTACT_PHONE_FIELD_OPTIONS: readonly StoreContactPhoneField[] = [
  "hidden",
  "optional",
  "required",
];

/** The saved settings as form values: nulls read as empty strings. */
export const buildContactSettingsDefaults = (
  store: ContactSettingsStore,
): ContactSettingsFormValues => {
  const settings = resolveStoreContactSettings(store.settings);

  return {
    layout: settings.layout,
    primaryChannel: settings.primaryChannel,
    phone: settings.phone,
    sms: settings.sms,
    whatsapp: settings.whatsapp,
    whatsappNumber: settings.whatsappNumber ?? "",
    email: settings.email,
    form: settings.form,
    formRecipientEmail: settings.formRecipientEmail ?? "",
    formPhoneField: settings.formPhoneField,
    intro: settings.intro ?? "",
  };
};

const CONTACT_SETTINGS_EMPTY_VALUES: ContactSettingsFormValues = {
  layout: "full",
  primaryChannel: "phone",
  phone: true,
  sms: false,
  whatsapp: false,
  whatsappNumber: "",
  email: true,
  form: true,
  formRecipientEmail: "",
  formPhoneField: "optional",
  intro: "",
};

export const contactSettingsFormOptions = formOptions({
  defaultValues: CONTACT_SETTINGS_EMPTY_VALUES,
  validators: { onSubmit: updateStoreContactInputSchema },
  validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
});

/**
 * Type-only placeholder for `withForm({ props })`: TanStack reads the value
 * for inference alone, the real props always come from the parent.
 */
export const contactSectionProps = <TProps extends object>(): TProps => Object.create(null);
