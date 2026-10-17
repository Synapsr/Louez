"use client";

import { useState } from "react";
import { LIVE_VOICES, resolveLiveVoice } from "@louez/voice/catalog";
import { useVoicePreview } from "@/hooks/use-voice-preview";
import { VoicePreviewButton } from "@/components/dashboard/voice/voice-preview-button";
import { useTranslations } from "next-intl";
import { AudioLinesIcon, CheckCircleIcon, CircleIcon, RotateCcwIcon } from "@louez/ui/icons";

import {
  Badge,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
} from "@louez/ui";
import { cn } from "@louez/utils";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

interface VoicePickerProps {
  value: string;
  onChange: (voiceId: string) => void;
  /** App locale — drives the preview language AND the recommended default. */
  language: string;
  defaultVoice?: string;
  previewEnabled: boolean;
}

/**
 * Compact voice control: a single row showing the voice in use (the operator's
 * per-language recommendation until the store picks one), with the full picker
 * (gender filter + audio previews) in a dedicated dialog — the settings form
 * stays short, choosing a voice becomes a focused moment.
 */
export const VoicePicker = ({
  value,
  onChange,
  language,
  defaultVoice,
  previewEnabled,
}: VoicePickerProps) => {
  const t = useTranslations("dashboard.settings.aiVoiceAgent");

  const [modalOpen, setModalOpen] = useState(false);
  const [gender, setGender] = useState<"female" | "male" | null>(null);
  const preview = useVoicePreview(language);
  const effectiveId = resolveLiveVoice(language, value, defaultVoice);
  const voices = LIVE_VOICES.map((voice) => ({
    ...voice,
    recommended: voice.id === resolveLiveVoice(language, "", defaultVoice),
  })).sort((a, b) => Number(b.recommended) - Number(a.recommended));
  const effectiveVoice = voices.find((voice) => voice.id === effectiveId);
  const isUsingDefault = !value;
  const genders = ["female", "male"] as const;
  const showGenderFilter = true;
  const filtered = gender ? voices.filter((voice) => voice.gender === gender) : voices;

  const closeModal = (open: boolean) => {
    if (!open) preview.stop();
    setModalOpen(open);
  };

  return (
    <div className="space-y-2">
      <Label>
        {t("voice")} <span className="text-muted-foreground text-xs">GPT-Live</span>
      </Label>

      {/* Current voice, one compact row */}
      <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="bg-primary/10 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
            <AudioLinesIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {effectiveVoice?.label ?? t("voiceModal.defaultVoice")}
              </span>
              {isUsingDefault && (
                <Badge variant="info" className="shrink-0 text-[10px]">
                  {t("voiceModal.defaultBadge")}
                </Badge>
              )}
            </div>
            {effectiveVoice?.gender && (
              <p className="text-muted-foreground text-xs">
                {t(`voiceGender.${effectiveVoice.gender}`)}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {previewEnabled && effectiveVoice && (
            <VoicePreviewButton
              voiceId={effectiveVoice.id}
              label={effectiveVoice.label}
              playing={preview.playingId === effectiveVoice.id}
              loading={preview.loadingId === effectiveVoice.id}
              onToggle={preview.toggle}
            />
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(true)}>
            {t("voiceModal.change")}
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">{t("voiceDescription")}</p>
      {preview.failed && (
        <p role="alert" className="text-destructive text-sm">
          {t("voicePreviewError")}
        </p>
      )}

      {/* Full picker in a dedicated dialog */}
      <Dialog open={modalOpen} onOpenChange={closeModal}>
        <DialogPopup className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <DashboardIconTile icon={AudioLinesIcon} accent="primary" />
              {t("voiceModal.title")}
            </DialogTitle>
            <DialogDescription>{t("voiceModal.description")}</DialogDescription>
          </DialogHeader>

          <DialogPanel>
            {preview.failed && (
              <p role="alert" className="text-destructive text-sm">
                {t("voicePreviewError")}
              </p>
            )}
            <div className="space-y-3 pt-1">
              {showGenderFilter && (
                <div className="flex gap-1">
                  {([null, "female", "male"] as const).map((option) => {
                    if (option !== null && !genders.includes(option)) return null;
                    return (
                      <Button
                        key={option ?? "all"}
                        type="button"
                        size="sm"
                        variant={gender === option ? "default" : "outline"}
                        onClick={() => setGender(option)}
                      >
                        {option === null ? t("voiceGender.all") : t(`voiceGender.${option}`)}
                      </Button>
                    );
                  })}
                </div>
              )}

              <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {filtered.map((voice) => {
                  const isSelected = effectiveId === voice.id;
                  return (
                    <div
                      key={voice.id}
                      className={cn(
                        "flex items-center justify-between gap-2 p-2.5",
                        isSelected && "bg-accent/50",
                      )}
                    >
                      <Button
                        variant="ghost"
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          preview.stop();
                          onChange(voice.id);
                        }}
                        className="h-auto min-w-0 flex-1 justify-start gap-2 px-0 py-1 text-left [&>span]:min-w-0"
                      >
                        {isSelected ? (
                          <CheckCircleIcon className="text-primary h-4 w-4 shrink-0" />
                        ) : (
                          <CircleIcon className="text-muted-foreground h-4 w-4 shrink-0" />
                        )}
                        <span className="truncate text-sm font-medium">{voice.label}</span>
                        {voice.gender && (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {t(`voiceGender.${voice.gender}`)}
                          </span>
                        )}
                        {voice.recommended && (
                          <Badge variant="info" className="shrink-0">
                            {t("voiceRecommended")}
                          </Badge>
                        )}
                      </Button>
                      {previewEnabled && (
                        <VoicePreviewButton
                          voiceId={voice.id}
                          label={voice.label}
                          playing={preview.playingId === voice.id}
                          loading={preview.loadingId === voice.id}
                          onToggle={preview.toggle}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </DialogPanel>

          <DialogFooter className="flex items-center justify-between gap-2">
            {!isUsingDefault ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  preview.stop();
                  onChange("");
                }}
              >
                <RotateCcwIcon className="h-3.5 w-3.5" />
                {t("voiceModal.resetToRecommended")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" onClick={() => closeModal(false)}>
              {t("voiceModal.done")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
};
