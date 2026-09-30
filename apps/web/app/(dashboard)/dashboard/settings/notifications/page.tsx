import { redirect } from "next/navigation";
import { getCurrentStore } from "@/lib/store-context";
import { NotificationsContent } from "./notifications-content";
import { getNotificationSettings } from "./actions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function NotificationsPage() {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  const data = await getNotificationSettings();
  if ("error" in data) redirect("/onboarding");

  // Prepare store info for email preview
  const storeInfo = {
    name: store.name,
    logoUrl: store.logoUrl,
    darkLogoUrl: store.darkLogoUrl,
    email: store.email,
    phone: store.phone,
    address: store.address,
    theme: store.theme,
  };

  return (
    <NotificationsContent
      settings={data.settings}
      discordWebhookUrl={data.discordWebhookUrl}
      ownerPhone={data.ownerPhone}
      smsQuota={data.smsQuota}
      customerSettings={data.customerSettings}
      storeLocale={data.storeLocale}
      storeLanguageName={data.storeLanguageName}
      storeInfo={storeInfo}
    />
  );
}
