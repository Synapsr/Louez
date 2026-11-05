"use client";

import type { CheckoutProfileField } from "@louez/validations";

import { ProfileBirthDateInput } from "./profile-birth-date-input";
import { ProfileSocialLinksInput } from "./profile-social-links-input";
import { ProfileSourceInput } from "./profile-source-input";
import { EMPTY_CUSTOMER_PROFILE_FORM_VALUES } from "./util.customer-profile-fields";

interface ProfileFieldPreviewProps {
  field: CheckoutProfileField;
  /** Prefix of the DOM ids, unique on the page. */
  idPrefix: string;
}

/** The inputs are there to be looked at: nothing to type in a preview. */
const ignoreChange = () => undefined;

/** A native profile field exactly as the checkout shows it, empty: for the owner's preview. */
export const ProfileFieldPreview = ({ field, idPrefix }: ProfileFieldPreviewProps) => {
  const id = `${idPrefix}-${field.key}`;
  switch (field.key) {
    case "birthDate":
      return (
        <ProfileBirthDateInput
          collectMode={field.collectMode}
          id={id}
          value={EMPTY_CUSTOMER_PROFILE_FORM_VALUES.birthDate}
          onChange={ignoreChange}
        />
      );
    case "acquisitionSource":
      return (
        <ProfileSourceInput
          collectMode={field.collectMode}
          id={id}
          value={EMPTY_CUSTOMER_PROFILE_FORM_VALUES.acquisitionSource}
          onChange={ignoreChange}
        />
      );
    case "socialLinks":
      return (
        <ProfileSocialLinksInput
          collectMode={field.collectMode}
          id={id}
          value={EMPTY_CUSTOMER_PROFILE_FORM_VALUES.socialLinks}
          onChange={ignoreChange}
        />
      );
  }
};
