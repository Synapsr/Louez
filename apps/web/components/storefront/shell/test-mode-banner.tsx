import { getTranslations } from "next-intl/server";

import { getStorefrontTestMode } from "@/lib/test-reservations/storefront-test-mode";

type TestModeBannerProps = {
  storeId: string;
  /** The storefront's path prefix on this host (`getStorefrontPathPrefix`). */
  basePath: string;
};

/**
 * The storefront's line while it is in test mode (lib/test-reservations): nothing
 * is charged, and a way out. Shown to the browser holding the test-mode cookie only.
 */
export const TestModeBanner = async ({ storeId, basePath }: TestModeBannerProps) => {
  if (!(await getStorefrontTestMode(storeId))) return null;

  const t = await getTranslations("storefront.testMode");
  return (
    <div
      data-slot="test-mode-banner"
      role="status"
      className="border-b border-warning/32 bg-warning/8 px-4 py-2 text-center text-sm text-balance"
    >
      <span className="font-medium">{t("banner")}</span>{" "}
      <a href={`${basePath}/test-mode?leave=1`} className="underline underline-offset-4">
        {t("leave")}
      </a>
    </div>
  );
};
