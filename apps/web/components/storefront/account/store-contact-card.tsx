import { useTranslations } from "next-intl";

import { StoreContactDetails } from "@/components/storefront/home/store-contact-details";

import { AccountCard } from "@/components/storefront/account/account-card";

interface StoreContactCardProps {
  storeName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

/** "Need help?": one line and the store's real contact channels. */
export const StoreContactCard = ({ storeName, email, phone, address }: StoreContactCardProps) => {
  const t = useTranslations("storefront.account");

  if (!email && !phone && !address) return null;

  return (
    <AccountCard title={t("needHelp")} className="bg-muted shadow-none">
      <p className="text-sm text-muted-foreground">{t("contactStore", { name: storeName })}</p>
      <StoreContactDetails
        address={address}
        phone={phone}
        email={email}
        iconClassName="bg-background"
      />
    </AccountCard>
  );
};
