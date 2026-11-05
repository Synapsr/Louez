"use client";

import { useTranslations } from "next-intl";

import { CustomerFormInputPreview } from "./customer-form-input-preview";
import { CustomerFormRowFrame } from "./customer-form-row-frame";

/**
 * "Pour qui ?": the first question of every rented item, built in. Drawn like
 * the other rows, locked, and nothing to open or move.
 */
export const CustomerFormParticipantRow = () => {
  const t = useTranslations("dashboard.reservationDetails.itemDetails");

  return (
    <CustomerFormRowFrame
      label={t("participantName")}
      locked
      full
      preview={
        <CustomerFormInputPreview kind="text" placeholder={t("participantNamePlaceholder")} />
      }
    />
  );
};
