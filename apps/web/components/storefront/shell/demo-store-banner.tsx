import { getTranslations } from "next-intl/server";

import { env } from "@/env";

/**
 * The storefront's bar in a demo store (lib/demo), the dashboard's own bar in
 * the store's frame: it is a demonstration and the payment is simulated, back
 * to the store's dashboard, or on to the sign-up. Both links lead to the
 * dashboard host, where the demo lives.
 */
export const DemoStoreBanner = async () => {
  const t = await getTranslations("demo.storefrontBanner");
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  return (
    <div
      data-slot="demo-store-banner"
      role="region"
      aria-label={t("short")}
      className="flex h-10 items-center gap-3 border-b border-white/10 bg-neutral-950 px-3 text-white sm:px-4"
    >
      <p className="min-w-0 flex-1 truncate text-[13px] text-white/75">
        <span className="sm:hidden">{t("short")}</span>
        <span className="hidden sm:inline">{t("line")}</span>
      </p>
      <a
        href={`${appUrl}/dashboard`}
        className="hidden shrink-0 text-[13px] text-white/75 transition-colors hover:text-white md:inline"
      >
        {t("dashboard")}
      </a>
      <a
        href={`${appUrl}/demo/signup?from=storefront`}
        className="inline-flex h-7 shrink-0 items-center rounded-md bg-white px-3 text-[13px] font-medium text-neutral-950 transition-colors hover:bg-white/90"
      >
        <span className="sm:hidden">{t("signupShort")}</span>
        <span className="hidden sm:inline">{t("signup")}</span>
      </a>
    </div>
  );
};
