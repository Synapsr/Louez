import messages from "@/messages/fr.json";
import type { DemoScene } from "./policy";

const dashboard = {
  home: messages.dashboard.home,
  navigation: messages.dashboard.navigation,
  sidebar: messages.dashboard.sidebar,
  calendar: messages.dashboard.calendar,
  products: { form: messages.dashboard.products.form },
  reservations: messages.dashboard.reservations,
  emailContact: messages.dashboard.emailContact,
  phoneContact: messages.dashboard.phoneContact,
  referrals: { nudge: messages.dashboard.referrals.nudge },
  settings: {
    inspection: messages.dashboard.settings.inspection,
    aiAdvisor: { conversations: messages.dashboard.settings.aiAdvisor.conversations },
  },
};

export const getDemoMessages = (scene: DemoScene) => {
  if (scene === "advisor") {
    return {
      storefront: { advisor: messages.storefront.advisor, product: messages.storefront.product },
    };
  }
  const shared = { common: messages.common, errors: messages.errors };
  if (scene === "storefront") return { ...shared, storefront: messages.storefront };
  if (scene === "rental") return { ...shared, storefront: messages.storefront, dashboard };
  return { ...shared, dashboard };
};
