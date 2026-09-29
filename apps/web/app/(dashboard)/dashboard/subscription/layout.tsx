import type { ReactNode } from "react";
import { StoreSettingsAccess } from "@/components/dashboard/store-settings-access";

const SubscriptionLayout = ({ children }: { children: ReactNode }) => {
  return <StoreSettingsAccess>{children}</StoreSettingsAccess>;
};

export default SubscriptionLayout;
