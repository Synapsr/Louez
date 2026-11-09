"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "louez-show-welcome";

export const WELCOME_OVERLAY_COMPLETED_EVENT = "louez:welcome-overlay-completed";

const EASE = [0.19, 1, 0.22, 1] as const;
/** When each part of the message lands, in seconds. */
const HELLO_AT = 0.5;
const WORDS_AT = 0.65;
const WORD_STAGGER = 0.11;
/** How long the finished message holds before the space opens, in seconds. */
const HOLD_S = 2.8;
const EXIT_S = 0.7;
const SKIP_EXIT_S = 0.38;

/**
 * Whether the onboarding just ended: the last step sets a sessionStorage flag;
 * `?welcome=1` replays it for direct access.
 */
function shouldShowWelcome(): boolean {
  if (typeof window === "undefined") return false;

  if (sessionStorage.getItem(STORAGE_KEY) === "1") {
    sessionStorage.removeItem(STORAGE_KEY);
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("welcome") === "1") {
    const url = new URL(window.location.href);
    url.searchParams.delete("welcome");
    window.history.replaceState(null, "", url.pathname + url.search);
    return true;
  }

  return false;
}

interface WelcomeOverlayProps {
  storeName: string;
  firstName: string;
}

type Phase = "hidden" | "playing" | "exiting" | "complete";

/**
 * The moment that closes the onboarding: the store's name is the subject
 * ("Maison Pointure est en ligne."), the person is greeted above it, and a thin
 * bar shows the space is opening. Words land one by one over a slow Lagon and
 * Écume mist; a click, Enter, Space or Escape shortens it. With reduced motion
 * the message shows still, then fades.
 */
export const WelcomeOverlay = ({ storeName, firstName }: WelcomeOverlayProps) => {
  const t = useTranslations("welcome");
  const reducedMotion = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<Phase>("hidden");
  const [exitDuration, setExitDuration] = useState(EXIT_S);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasCheckedTriggerRef = useRef(false);

  const storeWords = storeName.trim().split(/\s+/).filter(Boolean);
  const onlineWords = t("isOnline").split(" ");
  const wordCount = storeWords.length + onlineWords.length;
  const subAt = WORDS_AT + wordCount * WORD_STAGGER + 0.35;
  const footAt = subAt + 0.7;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const exit = useCallback(
    (duration: number) => {
      clearTimers();
      setExitDuration(duration);
      setPhase((current) => (current === "playing" ? "exiting" : current));
      timersRef.current.push(setTimeout(() => setPhase("complete"), duration * 1000 + 150));
    },
    [clearTimers],
  );

  useEffect(() => {
    const audio = new Audio("/sounds/welcome.mp3");
    audio.volume = 0.5;
    audio.preload = "auto";
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    if (hasCheckedTriggerRef.current) return;
    hasCheckedTriggerRef.current = true;
    if (!shouldShowWelcome()) return;

    setPhase("playing");
    audioRef.current?.play().catch(() => {
      // Autoplay may be blocked by the browser.
    });
    const holdUntil = reducedMotion ? 3 : footAt + HOLD_S;
    timersRef.current.push(setTimeout(() => exit(reducedMotion ? 0.3 : EXIT_S), holdUntil * 1000));
  }, [exit, footAt, reducedMotion]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (phase === "complete") window.dispatchEvent(new Event(WELCOME_OVERLAY_COMPLETED_EVENT));
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        exit(SKIP_EXIT_S);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [exit, phase]);

  if (phase === "hidden" || phase === "complete") return null;

  const isExiting = phase === "exiting";
  const enter = (delay: number, y = 10) =>
    reducedMotion
      ? { initial: false as const }
      : {
          initial: { opacity: 0, y, filter: "blur(10px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 0.8, delay, ease: EASE },
        };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={firstName ? t("hello", { name: firstName }) : t("helloAnonymous")}
      onClick={() => exit(SKIP_EXIT_S)}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{
        duration: isExiting ? exitDuration : 0.7,
        delay: isExiting ? exitDuration * 0.45 : 0,
        ease: EASE,
      }}
      className="theme-lagon bg-background fixed inset-0 z-100 flex cursor-pointer items-center justify-center overflow-hidden"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-lagon-300 absolute -top-64 -left-40 size-140 rounded-full opacity-50 blur-[80px] motion-safe:animate-[welcome-drift-a_10s_ease-in-out_infinite_alternate] dark:opacity-30" />
        <div className="bg-ecume absolute -right-44 -bottom-72 size-140 rounded-full opacity-50 blur-[80px] motion-safe:animate-[welcome-drift-b_12s_ease-in-out_infinite_alternate] dark:opacity-30" />
        <div className="absolute inset-0 bg-[radial-gradient(color-mix(in_oklch,var(--color-primary)_18%,transparent)_1px,transparent_1px)] [mask-image:radial-gradient(50%_50%_at_50%_50%,#000,transparent)] bg-size-[22px_22px]" />
      </div>

      <motion.div
        animate={
          isExiting
            ? { opacity: 0, scale: 0.97, y: -10, filter: "blur(8px)" }
            : { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
        }
        transition={{ duration: isExiting ? exitDuration : 0, ease: EASE }}
        className="relative flex w-full max-w-2xl flex-col items-center gap-5 px-6 text-center"
      >
        <motion.p {...enter(HELLO_AT, 8)} className="text-muted-foreground text-base font-semibold">
          {firstName ? t("hello", { name: firstName }) : t("helloAnonymous")}
        </motion.p>

        <h1 className="text-4xl leading-[1.06] font-extrabold tracking-[-0.04em] text-balance sm:text-6xl">
          <span className="block">
            {storeWords.map((word, index) => (
              <motion.span
                key={`store-${index}-${word}`}
                {...enter(WORDS_AT + index * WORD_STAGGER, 18)}
                className="from-lagon-600 to-ecume inline-block bg-linear-to-r bg-clip-text pb-[0.08em] text-transparent"
              >
                {word}&nbsp;
              </motion.span>
            ))}
          </span>
          <span className="block">
            {onlineWords.map((word, index) => (
              <motion.span
                key={`online-${index}-${word}`}
                {...enter(WORDS_AT + (storeWords.length + index) * WORD_STAGGER, 18)}
                className="inline-block"
              >
                {word}&nbsp;
              </motion.span>
            ))}
          </span>
        </h1>

        <motion.p
          {...enter(subAt)}
          className="text-muted-foreground flex flex-wrap items-center justify-center gap-2.5 text-lg"
        >
          <span className="bg-success/12 text-success inline-flex items-center gap-1.5 rounded-full py-0.5 ps-2 pe-2.5 text-xs font-bold">
            <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            {t("online")}
          </span>
          {t("nextStep")}
        </motion.p>
      </motion.div>

      <motion.div
        {...(reducedMotion
          ? { initial: false as const }
          : {
              initial: { opacity: 0 },
              animate: { opacity: isExiting ? 0 : 1 },
              transition: { duration: 0.5, delay: isExiting ? 0 : footAt },
            })}
        className="text-muted-foreground absolute inset-x-0 bottom-8 flex flex-col items-center gap-2.5 text-sm"
      >
        <span>{t("opening")}</span>
        <span className="bg-border h-[3px] w-36 overflow-hidden rounded-full">
          <motion.span
            initial={reducedMotion ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: HOLD_S, delay: footAt, ease: "linear" }}
            className="bg-foreground block h-full origin-left"
          />
        </span>
      </motion.div>
    </motion.div>
  );
};
