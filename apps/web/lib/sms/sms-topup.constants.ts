export const SMS_TOPUP_PACKAGES = [50, 100, 250, 500] as const;

export type SmsTopupPackage = (typeof SMS_TOPUP_PACKAGES)[number];
