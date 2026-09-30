"use client";

import type { CustomerFieldCollectMode } from "@louez/types";

import type { CustomerSocialLinksFormValue } from "./customer-fields.types";
import { ProfileSocialLinksInput } from "./profile-social-links-input";
import { useProfileFieldBinding } from "./use-profile-field-binding";

interface ProfileSocialLinksFormInputProps {
  collectMode: CustomerFieldCollectMode;
}

/** The social links bound to the `form.AppField` they are rendered in. */
export const ProfileSocialLinksFormInput = ({ collectMode }: ProfileSocialLinksFormInputProps) => {
  const binding = useProfileFieldBinding<CustomerSocialLinksFormValue>();
  return <ProfileSocialLinksInput collectMode={collectMode} {...binding} />;
};
