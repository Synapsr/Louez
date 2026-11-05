"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldCollectMode } from "@louez/types";
import { Label } from "@louez/ui";

import { SocialLinksInput } from "@/components/dashboard/customers/social-links-input";

import { CustomerFieldHints } from "./customer-field-hints";
import type { CustomerSocialLinksFormValue } from "./customer-fields.types";
import { NO_PROFILE_FIELD_HINTS } from "./util.customer-profile-fields";

interface ProfileSocialLinksInputProps {
  collectMode: CustomerFieldCollectMode;
  /** DOM id of the group, so a refused value can be scrolled to. */
  id: string;
  value: CustomerSocialLinksFormValue;
  onChange: (value: CustomerSocialLinksFormValue) => void;
  /** Focus left one of its inputs. */
  onBlur?: () => void;
  /** Already-translated error. */
  error?: string;
}

/**
 * The customer's networks and website, added one by one with the control the
 * team uses on the record: a handle or a pasted profile link, settled on blur.
 */
export const ProfileSocialLinksInput = ({
  collectMode,
  id,
  value,
  onChange,
  onBlur,
  error,
}: ProfileSocialLinksInputProps) => {
  const t = useTranslations("storefront.customerFields");
  const label = t("profile.socialLinks");
  const labelId = `${id}-label`;
  const hintsId = `${id}-hints`;

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={error ? hintsId : undefined}
      className="flex min-w-0 flex-col gap-2"
      onBlur={onBlur}
    >
      {/* A group has no single control to point a <label> at: same look, as a paragraph. */}
      <Label id={labelId} render={<p />} data-error={Boolean(error)}>
        {collectMode === "required" ? label : t("optionalLabel", { label })}
      </Label>
      <SocialLinksInput value={value} onChange={onChange} />
      <CustomerFieldHints id={hintsId} field={NO_PROFILE_FIELD_HINTS} value="" error={error} />
    </div>
  );
};
