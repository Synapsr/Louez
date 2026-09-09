"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { rejectReturnDateChange } from "@/app/(dashboard)/dashboard/reservations/date-change-actions";
import type { DateChangeRequest } from "@/lib/reservations/util.date-change-request";

interface DateChangeReviewProps {
  reservationId: string;
  request: DateChangeRequest;
  dateLabel: string;
  canWrite: boolean;
  onApply?: () => void;
}

export const DateChangeReview = ({
  reservationId,
  request,
  dateLabel,
  canWrite,
  onApply,
}: DateChangeReviewProps) => {
  const t = useTranslations("storefront.account.dateChange");
  const router = useRouter();
  const reject = useMutation({
    mutationFn: async () => {
      const result = await rejectReturnDateChange(reservationId, request.id);
      if ("error" in result) throw new Error("rejected");
    },
    onSuccess: () => router.refresh(),
  });
  return (
    <section className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <h2 className="font-semibold">{t("reviewTitle")}</h2>
      <p className="text-sm font-medium">
        {t("newEnd")}: {dateLabel}
      </p>
      {request.reason ? <p className="whitespace-pre-wrap text-sm">{request.reason}</p> : null}
      <p className="text-sm text-muted-foreground">{t("reviewHelp")}</p>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {onApply ? (
            <Button type="button" onClick={onApply}>
              {t("apply")}
            </Button>
          ) : (
            <Button render={<Link href={`/dashboard/reservations/${reservationId}/edit`} />}>
              {t("review")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={reject.isPending}
            onClick={() => reject.mutate()}
          >
            {t("reject")}
          </Button>
        </div>
      ) : null}
      {reject.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("reviewError")}
        </p>
      ) : null}
    </section>
  );
};
