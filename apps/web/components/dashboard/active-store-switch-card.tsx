import { getTranslations } from "next-intl/server";
import Link from "next/link";

import { DASHBOARD_STORE_PARAM } from "@louez/api/platform/links";
import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@louez/ui";

import { ACTIVE_STORE_NEXT_PARAM, ACTIVE_STORE_ROUTE } from "@/lib/util.active-store-link";

interface ActiveStoreSwitchCardProps {
  target: { id: string; name: string };
  current: { id: string; name: string };
  /** The dashboard path the link points to, without its store. */
  next: string;
}

/**
 * Asks before a dashboard link switches the active store. Opening posts the
 * form to the active-store route; staying goes to the same page in the
 * current store.
 */
export const ActiveStoreSwitchCard = async ({
  target,
  current,
  next,
}: ActiveStoreSwitchCardProps) => {
  const t = await getTranslations("activeStoreSwitch");

  return (
    <Card>
      <CardHeader className="space-y-2 p-5 sm:p-6">
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>
          {t("description", { target: target.name, current: current.name })}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-col-reverse gap-2 p-5 pt-0 sm:flex-row sm:justify-end sm:p-6 sm:pt-0">
        <Button variant="outline" render={<Link href={next} />}>
          {t("stay", { current: current.name })}
        </Button>
        <form method="post" action={ACTIVE_STORE_ROUTE}>
          <input type="hidden" name={DASHBOARD_STORE_PARAM} value={target.id} />
          <input type="hidden" name={ACTIVE_STORE_NEXT_PARAM} value={next} />
          <Button type="submit" className="w-full sm:w-auto">
            {t("open", { target: target.name })}
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
};
