"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { motion } from "framer-motion";
import { ExternalLink, Github, Star } from "lucide-react";
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

const REPOSITORY_URL = "https://github.com/Synapsr/Louez";
const REPOSITORY_LABEL = "Synapsr/Louez";

/** Set once the operator stars the repository. Survives sessions: never ask again. */
const DISMISSED_KEY = "louez-star-prompt-dismissed";
/** Set as soon as the dialog is shown, so it asks at most once per session. */
const SEEN_KEY = "louez-star-prompt-seen";
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
 * Asks self-hosters to star the repository, once per session, from the
 * dashboard only.
 *
 * Rendered exclusively in standalone mode (see the dashboard layout): the
 * cloud never ships it. It makes no outbound request — the star count is not
 * fetched, so a self-hosted instance still talks to nobody until the operator
 * clicks through.
 */
export function StarPrompt() {
  const t = useTranslations("dashboard.starPrompt");
  const [open, setOpen] = useState(false);
  // Without this, focus lands on the source-code link and rings the card the
  // eye is not meant to start on.
  const starButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (readStorage(localStorage, DISMISSED_KEY)) return;
    if (readStorage(sessionStorage, SEEN_KEY)) return;
    // The first dashboard visit belongs to the welcome animation, and a store
    // created two minutes ago has not earned anyone's gratitude yet.
    if (readStorage(sessionStorage, WELCOME_KEY)) return;

    const timer = setTimeout(() => {
      writeStorage(sessionStorage, SEEN_KEY, "1");
      setOpen(true);
    }, DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  // Starring is the only permanent dismissal: "Maybe later" simply lets the
  // next session ask again.
  const handleStar = useCallback(() => {
    window.open(REPOSITORY_URL, "_blank", "noopener,noreferrer");
    writeStorage(localStorage, DISMISSED_KEY, "1");
    setOpen(false);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="sm:max-w-md" initialFocus={starButtonRef}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-balance">
            <DashboardIconTile icon={Star} accent="pending" />
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
              className="border-border bg-card hover:border-primary/30 group flex items-center gap-2.5 rounded-xl border p-3 transition-[border-color,box-shadow,scale] duration-150 ease-out hover:shadow-sm active:scale-[0.96]"
            >
              <Github className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{REPOSITORY_LABEL}</span>
                <span className="text-muted-foreground block text-xs">{t("sourceHint")}</span>
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
          <Button ref={starButtonRef} onClick={handleStar} className="gap-2 active:scale-[0.96]">
            <Star className="size-4" />
            {t("star")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
