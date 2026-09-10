export { sendEmail, isEmailConfigured } from "./send";
export type { EmailLocale, EmailAttachment, SendEmailOptions } from "./types";
export { MagicLinkEmail } from "./templates/magic-link";
export { OTPEmail } from "./templates/otp";
export { DeleteAccountEmail, getDeleteAccountEmailSubject } from "./templates/delete-account";
export { BaseLayoutSimple } from "./templates/base-layout-simple";
export {
  DEFAULT_PRIMARY_COLOR,
  LOUEZ_BRAND_COLOR,
  emailTheme,
  shell,
  styles,
} from "./templates/theme";
