"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { motion } from "framer-motion";
import { ExternalLink, Github, MessageSquareText, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";

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
} from "@louez/ui";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

/** G2's review form for Louez: asks for an honest review, with nothing in exchange. */
const G2_REVIEW_URL = "https://www.g2.com/products/louez/take_survey";
const REPOSITORY_URL = "https://github.com/Synapsr/Louez";
const REPOSITORY_LABEL = "Synapsr/Louez";

/** Set once the operator goes to G2 or GitHub. Survives sessions: never ask again. */
const DISMISSED_KEY = "louez-review-prompt-dismissed";
/** Set as soon as the dialog is shown, so it asks at most once per session. */
const SEEN_KEY = "louez-review-prompt-seen";
/** Consumed by the welcome overlay on the very first dashboard visit. */
const WELCOME_KEY = "louez-show-welcome";

/** Let the dashboard paint and settle before interrupting. */
const DELAY_MS = 8000;

const readStorage = (storage: Storage, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    // Private browsing and locked-down profiles throw on access.
    return null;
  }
};

const writeStorage = (storage: Storage, key: string, value: string) => {
  try {
    storage.setItem(key, value);
  } catch {
    // Losing the flag only means the prompt may ask again — never a crash.
  }
};

/**
 * Asks self-hosters for an honest review on G2, and a star on GitHub, once per
 * session, from the dashboard only.
 *
 * Rendered only on a self-hosted instance, LOUEZ_HOSTED_BY unset (see the
 * dashboard layout): the cloud never ships it. It makes no outbound request —
 * no rating or star count is fetched, so a self-hosted instance still talks to
 * nobody until the operator clicks through.
 */
export const ReviewPrompt = () => {
  const t = useTranslations("dashboard.reviewPrompt");
  const [open, setOpen] = useState(false);
  // Without this, focus lands on the repository link and rings the card the
  // eye is not meant to start on.
  const reviewButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (readStorage(localStorage, DISMISSED_KEY)) return;
    if (readStorage(sessionStorage, SEEN_KEY)) return;
    // The first dashboard visit belongs to the welcome animation, and a store
    // created two minutes ago has nothing to review yet.
    if (readStorage(sessionStorage, WELCOME_KEY)) return;

    const timer = setTimeout(() => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [data-passkey-prompt]'))
        return;
      writeStorage(sessionStorage, SEEN_KEY, "1");
      setOpen(true);
    }, DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  // Going to G2 or to GitHub ends the ask for good: "Maybe later" simply lets
  // the next session ask again.
  const dismiss = useCallback(() => {
    writeStorage(localStorage, DISMISSED_KEY, "1");
    setOpen(false);
  }, []);

  const handleReview = useCallback(() => {
    window.open(G2_REVIEW_URL, "_blank", "noopener,noreferrer");
    dismiss();
  }, [dismiss]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="sm:max-w-md" initialFocus={reviewButtonRef}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-balance">
            <DashboardIconTile icon={MessageSquareText} accent="pending" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-pretty">{t("description")}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="space-y-3 pt-1">
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", duration: 0.3, bounce: 0, delay: 0.05 }}
              className="text-muted-foreground text-pretty text-sm"
            >
              {t("pitch")}
            </motion.p>

            <motion.a
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", duration: 0.3, bounce: 0, delay: 0.15 }}
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="border-border bg-card hover:border-primary/30 group flex items-center gap-2.5 rounded-xl border p-3 transition-[border-color,box-shadow,scale] duration-150 ease-out hover:shadow-sm active:scale-[0.96]"
            >
              <Github className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{REPOSITORY_LABEL}</span>
                <span className="text-muted-foreground block text-xs">{t("star")}</span>
              </span>
              <Badge variant="tertiary" className="shrink-0 text-[10px]">
                AGPL-3.0
              </Badge>
              <ExternalLink className="text-muted-foreground group-hover:text-foreground size-3.5 shrink-0 transition-colors duration-150" />
            </motion.a>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("later")}
          </Button>
          <Button
            ref={reviewButtonRef}
            onClick={handleReview}
            className="gap-2 active:scale-[0.96]"
          >
            <SquarePen className="size-4" />
            {t("review")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
