import { getTranslations } from "next-intl/server";

import { env } from "@/env";

/**
 * The storefront's line in a demo store (lib/demo): it is a demonstration,
 * nothing is charged, and the two ways on: back to the store's dashboard, or
 * to the sign-up. Both links lead to the dashboard host, where the demo lives.
 */
export const DemoStoreBanner = async () => {
  const t = await getTranslations("demo.storefrontBanner");
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  return (
    <div
      data-slot="demo-store-banner"
      role="status"
      className="flex flex-col items-center justify-center gap-x-4 gap-y-1 border-b border-amber-300/70 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950 sm:flex-row dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <span>
        <span className="font-semibold">{t("title")}</span> {t("detail")}
      </span>
      <span className="flex gap-4">
        <a href={`${appUrl}/dashboard`} className="underline underline-offset-4">
          {t("dashboard")}
        </a>
        <a
          href={`${appUrl}/demo/signup?from=storefront`}
          className="font-semibold underline underline-offset-4"
        >
          {t("signup")}
        </a>
      </span>
    </div>
  );
};
