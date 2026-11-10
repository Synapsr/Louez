"use client";

import { useState } from "react";

import Link from "next/link";

import { ArrowRight, Lightbulb, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { dismissNotice } from "@/app/(dashboard)/dashboard/actions";
import { HOME_TIP_NOTICE_ID, type HomeTipKey } from "@/lib/dashboard/util.home-tip";

const TIP_HREF: Record<HomeTipKey, string> = {
  onlinePayments: "/dashboard/settings/payments",
  manualReservation: "/dashboard/reservations/new?source=quick_action",
  reviewBooster: "/dashboard/settings/review-booster",
};

/**
 * One "next step" at the foot of the requests card: Stripe for a store paid
 * on site, or a hand for a starting store. It leads to a page that already
 * exists; closing it is for good, on every browser (a dismissible notice).
 * The next tip shows on the next visit.
 */
export const HomeTip = ({ tip }: { tip: HomeTipKey }) => {
  const t = useTranslations("dashboard.home.tips");
  const [closed, setClosed] = useState(false);

  if (closed) return null;

  const close = () => {
    setClosed(true);
    void dismissNotice(HOME_TIP_NOTICE_ID[tip]);
  };

  return (
    <div className="bg-card flex w-full items-start gap-2.5 rounded-xl border py-2 ps-2.5 pe-1.5 text-left">
      <span
        aria-hidden
        className="bg-accent text-primary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg"
      >
        <Lightbulb className="size-3.5" />
      </span>
      {/* One sentence, its bold lead as the title, then the way to act on it. */}
      <p className="text-muted-foreground min-w-0 flex-1 py-0.5 text-xs leading-relaxed text-pretty">
        <span className="sr-only">{t("label")} : </span>
        <b className="text-foreground text-[13px] font-semibold">{t(`${tip}.title`)}</b>{" "}
        {t(`${tip}.text`)}{" "}
        <Link
          href={TIP_HREF[tip]}
          className="text-primary focus-visible:ring-ring inline-flex items-center gap-0.5 rounded-sm font-semibold whitespace-nowrap hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {t(`${tip}.action`)}
          <ArrowRight className="size-3" />
        </Link>
      </p>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={close}
        aria-label={t("dismiss")}
        title={t("dismiss")}
        className="text-muted-foreground shrink-0 rounded-full"
      >
        <X />
      </Button>
    </div>
  );
};
