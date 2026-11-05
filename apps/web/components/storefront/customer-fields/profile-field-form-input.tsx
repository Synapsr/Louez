"use client";

import type { CheckoutProfileField } from "@louez/validations";

import { ProfileBirthDateFormInput } from "./profile-birth-date-form-input";
import { ProfileSocialLinksFormInput } from "./profile-social-links-form-input";
import { ProfileSourceFormInput } from "./profile-source-form-input";

interface ProfileFieldFormInputProps {
  field: CheckoutProfileField;
}

/**
 * A native profile field bound to the `form.AppField` named after it
 * (`profileFields.<key>`): the checkout and the account profile render it
 * the same way.
 */
export const ProfileFieldFormInput = ({ field }: ProfileFieldFormInputProps) => {
  switch (field.key) {
    case "birthDate":
      return <ProfileBirthDateFormInput collectMode={field.collectMode} />;
    case "acquisitionSource":
      return <ProfileSourceFormInput collectMode={field.collectMode} />;
    case "socialLinks":
      return <ProfileSocialLinksFormInput collectMode={field.collectMode} />;
  }
};
