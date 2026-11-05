"use client";

import type { CustomerFieldCollectMode } from "@louez/types";

import type { CustomerProfileFormValues } from "./customer-fields.types";
import { ProfileSourceInput } from "./profile-source-input";
import { useProfileFieldBinding } from "./use-profile-field-binding";

interface ProfileSourceFormInputProps {
  collectMode: CustomerFieldCollectMode;
}

/** The customer source and its "Précisez", bound to the `form.AppField` they are rendered in. */
export const ProfileSourceFormInput = ({ collectMode }: ProfileSourceFormInputProps) => {
  const binding = useProfileFieldBinding<CustomerProfileFormValues["acquisitionSource"]>();
  return <ProfileSourceInput collectMode={collectMode} {...binding} />;
};
