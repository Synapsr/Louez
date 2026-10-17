"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const useVoicePreview = (language: string) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const dispose = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (!audio) return;
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }, []);
  const stop = useCallback(() => {
    dispose();
    setPlayingId(null);
    setLoadingId(null);
  }, [dispose]);
  useEffect(() => {
    stop();
    return dispose;
  }, [language, stop, dispose]);

  const toggle = (voiceId: string) => {
    if (playingId === voiceId || loadingId === voiceId) {
      stop();
      return;
    }
    stop();
    setFailed(false);
    const audio = new Audio(
      `/api/voice/preview?voiceId=${encodeURIComponent(voiceId)}&language=${encodeURIComponent(language)}`,
    );
    audioRef.current = audio;
    setLoadingId(voiceId);
    const fail = () => {
      if (audioRef.current !== audio) return;
      stop();
      setFailed(true);
    };
    audio.onplaying = () => {
      if (audioRef.current !== audio) return;
      setLoadingId(null);
      setPlayingId(voiceId);
    };
    audio.onended = () => {
      if (audioRef.current === audio) stop();
    };
    audio.onerror = fail;
    void audio.play().catch(fail);
  };
  return { playingId, loadingId, failed, toggle, stop };
};
