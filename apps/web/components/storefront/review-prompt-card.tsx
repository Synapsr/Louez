import { ExternalLinkIcon, StarIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

interface ReviewPromptCardProps {
  storeName: string;
  reviewUrl: string;
}

/** After a completed rental: five stars, one line, one link to Google. */
export const ReviewPromptCard = ({ storeName, reviewUrl }: ReviewPromptCardProps) => {
  const t = useTranslations("storefront.account.reviewPrompt");

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-warning/12 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-6">
      <div aria-hidden className="flex items-center gap-0.5 text-warning">
        {Array.from({ length: 5 }).map((_, index) => (
          <StarIcon key={index} className="size-5 fill-current" />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium leading-snug">{t("title")}</p>
        <p className="text-sm text-muted-foreground">{t("description", { name: storeName })}</p>
      </div>
      <Button
        size="lg"
        className="h-11 w-full sm:w-auto lg:h-9"
        render={<a href={reviewUrl} target="_blank" rel="noopener noreferrer" />}
      >
        {t("leaveReview")}
        <ExternalLinkIcon data-slot="icon" />
      </Button>
    </div>
  );
};
