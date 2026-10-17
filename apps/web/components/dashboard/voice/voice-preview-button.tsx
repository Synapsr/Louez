"use client";

import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { PauseIcon, PlayIcon } from "@louez/ui/icons";

export const VoicePreviewButton = ({
  voiceId,
  label,
  playing,
  loading,
  disabled = false,
  onToggle,
}: {
  voiceId: string;
  label: string;
  playing: boolean;
  loading: boolean;
  disabled?: boolean;
  onToggle: (voiceId: string) => void;
}) => {
  const t = useTranslations("dashboard.settings.aiVoiceAgent");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`${t("voicePreview")} ${label}`}
      aria-pressed={playing}
      disabled={disabled}
      title={disabled ? t("voicePreviewUnavailable") : undefined}
      onClick={() => onToggle(voiceId)}
      isPending={loading}
    >
      {playing ? <PauseIcon data-slot="icon" /> : <PlayIcon data-slot="icon" />}
    </Button>
  );
};
