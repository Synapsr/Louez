import {
  DEFAULT_STORE_CONTACT_SETTINGS,
  type StoreContactLayout,
  type StoreContactPhoneField,
  type StoreContactPrimaryChannel,
  type StoreContactSettings,
  type StoreSettings,
} from "@louez/types";

interface StoreContactSource {
  email: string | null;
  phone: string | null;
  settings: StoreSettings | null | undefined;
}

/** The one big action of a `single` page: which channel and the value behind it. */
export interface StoreContactPrimaryAction {
  kind: StoreContactPrimaryChannel;
  /** Phone as typed, WhatsApp digits, or the email address. */
  value: string;
}

/** What the storefront may offer: every value already checked against the store's fields. */
export interface StoreContactChannels {
  /** Page shape chosen in the dashboard. */
  layout: StoreContactLayout;
  /** The action a `single` page is built around; null when its channel is unavailable. */
  primary: StoreContactPrimaryAction | null;
  /** Store phone, shown as a call option. */
  phone: string | null;
  /** Whether the phone row also offers an SMS. */
  sms: boolean;
  /** Number behind the WhatsApp link, or null when the channel is off. */
  whatsapp: string | null;
  /** Store email, shown as a write option. */
  email: string | null;
  /** Whether the contact form is shown; null when it is off or has no recipient. */
  form: { recipient: string; phoneField: StoreContactPhoneField } | null;
  /** Plain-text intro of the contact page. */
  intro: string | null;
}

const trimToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/** The saved settings over the defaults, so stores saved before a new field still read it. */
export const resolveStoreContactSettings = (
  settings: StoreSettings | null | undefined,
): StoreContactSettings => ({ ...DEFAULT_STORE_CONTACT_SETTINGS, ...settings?.contact });

/** Digits and a leading plus only: what `wa.me` links accept. */
export const toWhatsAppNumber = (phone: string): string | null => {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 6 ? digits : null;
};

/**
 * Which contact channels a storefront shows, from the store's own fields and
 * its contact settings. A toggled-on channel whose field is empty stays
 * hidden, so the page never offers a number or address the store lacks.
 */
export const resolveStoreContactChannels = (store: StoreContactSource): StoreContactChannels => {
  const settings = resolveStoreContactSettings(store.settings);
  const storePhone = trimToNull(store.phone);
  const storeEmail = trimToNull(store.email);
  const whatsappSource = trimToNull(settings.whatsappNumber) ?? storePhone;
  const formRecipient = trimToNull(settings.formRecipientEmail) ?? storeEmail;

  const phone = settings.phone ? storePhone : null;
  const whatsapp = settings.whatsapp && whatsappSource ? toWhatsAppNumber(whatsappSource) : null;
  const email = settings.email ? storeEmail : null;
  const primaryValue = { phone, whatsapp, email }[settings.primaryChannel];

  return {
    layout: settings.layout,
    primary: primaryValue ? { kind: settings.primaryChannel, value: primaryValue } : null,
    phone,
    sms: settings.phone && settings.sms && storePhone !== null,
    whatsapp,
    email,
    form:
      settings.form && formRecipient
        ? { recipient: formRecipient, phoneField: settings.formPhoneField }
        : null,
    intro: trimToNull(settings.intro),
  };
};

/** Whether the contact page has anything to show beyond the address. */
export const hasStoreContactChannels = (channels: StoreContactChannels): boolean =>
  channels.phone !== null ||
  channels.whatsapp !== null ||
  channels.email !== null ||
  channels.form !== null;
