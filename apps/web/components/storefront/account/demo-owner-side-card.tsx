import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";

import { env } from "@/env";

/**
 * On a demo store (lib/demo), the customer's booking page leads on to the
 * same booking on the rental side: the dashboard of the store, where the
 * visitor's demo account is signed in.
 */
export const DemoOwnerSideCard = async ({ reservationId }: { reservationId: string }) => {
  const t = await getTranslations("demo.ownerSide");
  const href = `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/dashboard/reservations/${reservationId}`;
  return (
    <div
      data-slot="demo-owner-side"
      className="flex flex-col gap-3 rounded-2xl bg-neutral-950 p-4 text-white sm:flex-row sm:items-center sm:gap-6 sm:p-6"
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium leading-snug">{t("title")}</p>
        <p className="text-sm text-white/70">{t("description")}</p>
      </div>
      <Button
        size="lg"
        className="h-11 w-full bg-white text-neutral-950 hover:bg-white/90 sm:w-auto lg:h-9"
        render={<a href={href} />}
      >
        {t("cta")}
        <ArrowUpRight data-slot="icon" />
      </Button>
    </div>
  );
};
