import { z } from "zod";

import type { StoreContactPhoneField } from "@louez/types";

export const CONTACT_MESSAGE_MAX_LENGTH = 4000;

export type ContactMessageErrorKey =
  | "firstNameRequired"
  | "lastNameRequired"
  | "invalidEmail"
  | "phoneRequired"
  | "messageTooShort"
  | "tooLong";

type ContactMessageTranslator = (key: ContactMessageErrorKey) => string;

/** Server-side parsing has no reader: the key itself is message enough. */
const identity: ContactMessageTranslator = (key) => key;

/**
 * What the visitor types. `website` is a honeypot the form never shows;
 * anything in it marks the submission as automated. The form passes a
 * translator so the messages read in the visitor's language.
 */
export const buildContactMessageSchema = (
  phoneField: StoreContactPhoneField,
  t: ContactMessageTranslator = identity,
) => {
  const phone = z.string().trim().max(50, t("tooLong"));

  return z.object({
    firstName: z.string().trim().min(1, t("firstNameRequired")).max(100, t("tooLong")),
    lastName: z.string().trim().min(1, t("lastNameRequired")).max(100, t("tooLong")),
    email: z
      .string()
      .trim()
      .max(320, t("tooLong"))
      .pipe(z.email(t("invalidEmail"))),
    phone: phoneField === "required" ? phone.min(1, t("phoneRequired")) : phone,
    message: z
      .string()
      .trim()
      .min(10, t("messageTooShort"))
      .max(CONTACT_MESSAGE_MAX_LENGTH, t("tooLong")),
    website: z.string().max(200).default(""),
  });
};

export type ContactMessageValues = z.input<ReturnType<typeof buildContactMessageSchema>>;
