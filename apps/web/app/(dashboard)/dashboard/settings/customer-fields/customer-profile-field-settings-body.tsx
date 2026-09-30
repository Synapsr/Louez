"use client";

import type { Ref } from "react";

import type { CustomerProfileFieldKey, CustomerProfileFieldSettings } from "@louez/types";

import { CustomerFieldOnlineGroup } from "./customer-field-online-group";
import { CustomerFieldRecordGroup } from "./customer-field-record-group";
import { CustomerProfileFieldGeneralGroup } from "./customer-profile-field-general-group";
import type { CustomerProfileFieldSettingKey } from "./use-customer-profile-field-autosave";
import { profileFieldAllowsRequired } from "./util.customer-field-canvas";
import { diffOnlineSettings } from "./util.customer-fields-builder";
import { pickOnlineSettings } from "./util.customer-field-online";
import {
  type CustomerProfileFieldPatch,
  toProfileVisibility,
} from "./util.customer-profile-field-settings";

interface CustomerProfileFieldSettingsBodyProps {
  field: CustomerProfileFieldKey;
  label: string;
  typeLabel: string;
  settings: CustomerProfileFieldSettings;
  onChange: (key: CustomerProfileFieldSettingKey, patch: CustomerProfileFieldPatch) => void;
  errorFor: (key: CustomerProfileFieldSettingKey) => string | undefined;
  /** Put on the top of "Réservation en ligne", for the client view to scroll to. */
  onlineRef?: Ref<HTMLParagraphElement>;
}

/**
 * The settings of a Louez profile field, in the same order and with the same
 * controls as a store field's; only its name and type are fixed, and there is
 * nothing more to fold away.
 */
export const CustomerProfileFieldSettingsBody = ({
  field,
  label,
  typeLabel,
  settings,
  onChange,
  errorFor,
  onlineRef,
}: CustomerProfileFieldSettingsBodyProps) => {
  const idPrefix = `inspector-profile-${field}`;
  const allowsRequired = profileFieldAllowsRequired(field);
  const shown = settings.visibility !== "hidden";
  const online = pickOnlineSettings(settings);

  return (
    <div className="flex flex-col divide-y">
      <CustomerProfileFieldGeneralGroup idPrefix={idPrefix} label={label} typeLabel={typeLabel} />

      <CustomerFieldRecordGroup
        idPrefix={idPrefix}
        scope="customer"
        shown={shown}
        required={allowsRequired ? settings.visibility === "required" : null}
        shownError={errorFor("shown")}
        requiredError={errorFor("required")}
        onShownChange={(next) =>
          onChange("shown", { visibility: toProfileVisibility({ shown: next }) })
        }
        onRequiredChange={(required) =>
          onChange("required", { visibility: toProfileVisibility({ required }) })
        }
      />

      <CustomerFieldOnlineGroup
        idPrefix={idPrefix}
        value={online}
        carriesItems={false}
        allowsRequired={allowsRequired}
        hidden={!shown}
        error={errorFor("online")}
        onChange={(next) => onChange("online", diffOnlineSettings(online, next))}
        anchorRef={onlineRef}
      />
    </div>
  );
};
