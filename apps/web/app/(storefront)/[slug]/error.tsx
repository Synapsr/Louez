"use client";

import { useEffect } from "react";

import { log } from "evlog/next/client";
import { AlertTriangleIcon, HomeIcon, RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { OutcomeHeader } from "@/components/storefront/ui/outcome-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

interface StorefrontErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Route error boundary of the storefront: one line, retry, home. */
const StorefrontError = ({ error, reset }: StorefrontErrorProps) => {
  const t = useTranslations("storefront.error");

  useEffect(() => {
    log.error({
      action: "storefront.render_error",
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <StorefrontSection width="narrow">
      <OutcomeHeader
        tone="destructive"
        icon={<AlertTriangleIcon />}
        title={t("title")}
        description={t("description")}
      >
        <Button size="xl" className="h-12 w-full lg:h-10 lg:w-auto" onClick={reset}>
          <RefreshCwIcon />
          {t("retry")}
        </Button>
        <Button
          variant="outline"
          size="xl"
          className="h-12 w-full lg:h-10 lg:w-auto"
          render={<StorefrontLink href="/" />}
        >
          <HomeIcon />
          {t("backToHome")}
        </Button>
      </OutcomeHeader>
    </StorefrontSection>
  );
};

export default StorefrontError;
