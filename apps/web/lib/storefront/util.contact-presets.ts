import type { StoreContactLayout, StoreContactPrimaryChannel } from "@louez/types";

/** The toggles a preset decides; everything else (numbers, intro, form options) is left alone. */
export interface ContactPresetToggles {
  layout: StoreContactLayout;
  primaryChannel: StoreContactPrimaryChannel;
  phone: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
  form: boolean;
}

type ContactChannelToggles = Pick<
  ContactPresetToggles,
  "phone" | "sms" | "whatsapp" | "email" | "form"
>;

export const CONTACT_LAYOUTS: readonly StoreContactLayout[] = ["full", "message", "single"];

export const CONTACT_PRIMARY_CHANNELS: readonly StoreContactPrimaryChannel[] = [
  "phone",
  "whatsapp",
  "email",
];

export const isContactLayout = (value: string): value is StoreContactLayout =>
  (CONTACT_LAYOUTS as readonly string[]).includes(value);

export const isContactPrimaryChannel = (value: string): value is StoreContactPrimaryChannel =>
  (CONTACT_PRIMARY_CHANNELS as readonly string[]).includes(value);

/** What each preset switches on. `single` depends on the chosen primary channel. */
const presetToggles = (
  layout: StoreContactLayout,
  primaryChannel: StoreContactPrimaryChannel,
): ContactChannelToggles => {
  switch (layout) {
    case "full":
      return { phone: true, sms: true, whatsapp: true, email: true, form: true };
    case "message":
      return { phone: false, sms: false, whatsapp: false, email: true, form: true };
    case "single":
      return {
        phone: primaryChannel === "phone",
        sms: false,
        whatsapp: primaryChannel === "whatsapp",
        email: primaryChannel === "email",
        form: false,
      };
  }
};

/** The toggles a preset sets, keeping the rest of the values as they are. */
export const applyContactPreset = <T extends ContactPresetToggles>(
  values: T,
  layout: StoreContactLayout,
  primaryChannel: StoreContactPrimaryChannel = values.primaryChannel,
): T => ({ ...values, layout, primaryChannel, ...presetToggles(layout, primaryChannel) });

/**
 * The preset the current toggles correspond to, or null once the store
 * adjusted a toggle by hand. The layout itself never changes here: a page
 * can be "full" in shape while its channels are custom.
 */
export const detectContactPreset = (values: ContactPresetToggles): StoreContactLayout | null => {
  const expected = presetToggles(values.layout, values.primaryChannel);
  const matches = (Object.keys(expected) as (keyof ContactChannelToggles)[]).every(
    (key) => expected[key] === values[key],
  );
  return matches ? values.layout : null;
};
