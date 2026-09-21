"use client";

import { useDebounce } from "@/hooks/use-debounce";
import { LinkIcon, WarningIcon } from "@louez/ui/icons";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
  Spinner,
} from "@louez/ui";
import {
  checkSlugAvailability,
  updateStoreSlug,
} from "@/app/(dashboard)/dashboard/settings/actions";

interface SlugChangeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSlug: string;
  domain: string;
}

type AvailabilityStatus = "idle" | "checking" | "available" | "unavailable" | "invalid" | "same";

export function SlugChangeModal({ open, onOpenChange, currentSlug, domain }: SlugChangeModalProps) {
  const router = useRouter();
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();

  const [slug, setSlug] = useState(currentSlug);
  const [status, setStatus] = useState<AvailabilityStatus>("idle");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedSlug = useDebounce(slug, 400);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSlug(currentSlug);
      setStatus("idle");
      setShowConfirmation(false);
      setError(null);
    }
  }, [open, currentSlug]);

  // Check availability when slug changes
  const checkAvailability = useCallback(
    async (slugToCheck: string) => {
      // Same as current
      if (slugToCheck === currentSlug) {
        setStatus("same");
        return;
      }

      // Validate format locally first
      const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      if (
        !slugToCheck ||
        slugToCheck.length < 3 ||
        slugToCheck.length > 50 ||
        !slugRegex.test(slugToCheck)
      ) {
        setStatus("invalid");
        return;
      }

      setStatus("checking");
      const result = await checkSlugAvailability(slugToCheck);

      if (result.error) {
        setStatus("invalid");
      } else {
        setStatus(result.available ? "available" : "unavailable");
      }
    },
    [currentSlug],
  );

  useEffect(() => {
    if (debouncedSlug && debouncedSlug !== currentSlug) {
      checkAvailability(debouncedSlug);
    } else if (debouncedSlug === currentSlug) {
      setStatus("same");
    }
  }, [debouncedSlug, currentSlug, checkAvailability]);

  const handleSlugChange = (value: string) => {
    // Normalize: lowercase, replace spaces with hyphens, remove invalid chars
    const normalized = value
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    setSlug(normalized);
    setStatus("idle");
    setError(null);
    setShowConfirmation(false);
  };

  const handleSubmit = () => {
    if (status !== "available") return;
    setShowConfirmation(true);
  };

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await updateStoreSlug(slug);

      if (result.error) {
        setError(t.has(result.error) ? t(result.error) : t("errors.generic"));
        setShowConfirmation(false);
        return;
      }

      if (result.success) {
        onOpenChange(false);
        router.refresh();
      }
    });
  };

  const getStatusIcon = () => {
    switch (status) {
      case "checking":
        return <Spinner className="h-4 w-4 text-muted-foreground" />;
      case "available":
        return <Check className="h-4 w-4 text-success" />;
      case "unavailable":
        return <X className="h-4 w-4 text-destructive" />;
      case "invalid":
        return <X className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case "checking":
        return t("dashboard.settings.slugChange.checking");
      case "available":
        return t("dashboard.settings.slugChange.available");
      case "unavailable":
        return t("dashboard.settings.slugChange.unavailable");
      case "invalid":
        return t("dashboard.settings.slugChange.invalid");
      case "same":
        return t("dashboard.settings.slugChange.same");
      default:
        return null;
    }
  };

  const canSubmit = status === "available" && !isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            {t("dashboard.settings.slugChange.title")}
          </DialogTitle>
          <DialogDescription>{t("dashboard.settings.slugChange.description")}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          {!showConfirmation ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="slug">{t("dashboard.settings.slugChange.label")}</Label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="slug"
                      value={slug}
                      onChange={(e) => handleSlugChange(e.target.value)}
                      placeholder={t("dashboard.settings.slugChange.placeholder")}
                      className="pr-10"
                      autoComplete="off"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {getStatusIcon()}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {slug ? `${slug}.${domain}` : `votre-boutique.${domain}`}
                </p>
                {status !== "idle" && status !== "checking" && (
                  <p
                    className={`text-sm ${
                      status === "available"
                        ? "text-success"
                        : status === "same"
                          ? "text-muted-foreground"
                          : "text-destructive"
                    }`}
                  >
                    {getStatusMessage()}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-muted bg-muted/30 p-3">
                <p className="text-sm text-muted-foreground">
                  {t("dashboard.settings.slugChange.formatHelp")}
                </p>
              </div>

              {error && (
                <Alert variant="error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Alert variant="warning">
                <WarningIcon className="h-4 w-4" />
                <AlertDescription className="ml-2">
                  <p className="font-medium">{t("dashboard.settings.slugChange.warning.title")}</p>
                  <ul className="mt-2 list-disc pl-4 space-y-1 text-sm">
                    <li>{t("dashboard.settings.slugChange.warning.point1")}</li>
                    <li>{t("dashboard.settings.slugChange.warning.point2")}</li>
                    <li>{t("dashboard.settings.slugChange.warning.point3")}</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("dashboard.settings.slugChange.currentUrl")}
                  </span>
                  <span className="font-mono line-through text-muted-foreground">
                    {currentSlug}.{domain}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("dashboard.settings.slugChange.newUrl")}
                  </span>
                  <span className="font-mono font-medium text-foreground">
                    {slug}.{domain}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DialogPanel>

        <DialogFooter>
          {!showConfirmation ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
                {t("dashboard.settings.slugChange.continue")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowConfirmation(false)}
                disabled={isPending}
              >
                {t("common.back")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirm}
                disabled={isPending}
                isPending={isPending}
              >
                {t("dashboard.settings.slugChange.confirmChange")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
