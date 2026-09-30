"use client";

import { useTranslations } from "next-intl";

import { Input, Label } from "@louez/ui";

/** Longest "Pour qui ?" a unit stores. */
const PARTICIPANT_NAME_MAX_LENGTH = 100;

interface RentalUnitParticipantFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

/**
 * "Pour qui ?" of a rented unit. Optional and short: a first name is enough
 * for the team to hand the right bike to the right person.
 */
export const RentalUnitParticipantField = ({
  id,
  value,
  onChange,
  onBlur,
}: RentalUnitParticipantFieldProps) => {
  const t = useTranslations("storefront.customerFields");

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{t("participantLabel")}</Label>
      <Input
        id={id}
        value={value}
        placeholder={t("participantPlaceholder")}
        autoComplete="off"
        maxLength={PARTICIPANT_NAME_MAX_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
};
