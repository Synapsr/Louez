import { Switch } from "@louez/ui";

import { PanelRow } from "./panel-row";

interface PanelSwitchRowProps {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  helper?: string;
}

/** An on/off setting on one line. */
export const PanelSwitchRow = ({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  hint,
  helper,
}: PanelSwitchRowProps) => (
  <PanelRow htmlFor={id} label={label} hint={hint} helper={helper}>
    <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
  </PanelRow>
);
