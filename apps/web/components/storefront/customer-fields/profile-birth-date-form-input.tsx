"use client";

import type { CustomerFieldCollectMode } from "@louez/types";

import { ProfileBirthDateInput } from "./profile-birth-date-input";
import { useProfileFieldBinding } from "./use-profile-field-binding";

interface ProfileBirthDateFormInputProps {
  collectMode: CustomerFieldCollectMode;
}

/** The birth date bound to the `form.AppField` it is rendered in. */
export const ProfileBirthDateFormInput = ({ collectMode }: ProfileBirthDateFormInputProps) => {
  const binding = useProfileFieldBinding<string>();
  return <ProfileBirthDateInput collectMode={collectMode} {...binding} />;
};
