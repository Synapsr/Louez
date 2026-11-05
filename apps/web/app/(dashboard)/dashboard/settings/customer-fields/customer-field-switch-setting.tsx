"use client";

import { PanelSwitchRow } from "@/components/online-store/panel/panel-switch-row";

interface CustomerFieldSwitchSettingProps {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  /** Set while the setting has no effect (a hidden field is required of nobody). */
  disabled?: boolean;
  /** Why the server refused the last change (a limit reached): the switch is already back. */
  error?: string;
  onCheckedChange: (checked: boolean) => void;
}

/** An on/off setting of the Sheet, saved as soon as it flips. */
export const CustomerFieldSwitchSetting = ({
  id,
  label,
  hint,
  checked,
  disabled,
  error,
  onCheckedChange,
}: CustomerFieldSwitchSettingProps) => (
  <div className="flex flex-col gap-1.5">
    <PanelSwitchRow
      id={id}
      label={label}
      hint={hint}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    />
    {error && <p className="text-destructive text-sm">{error}</p>}
  </div>
);
