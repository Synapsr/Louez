import { StorefrontSection } from "@/components/storefront/ui/storefront-section";

import { CheckoutSkeleton } from "./components/checkout-skeleton";

export default function CheckoutLoading() {
  return (
    <StorefrontSection spacing="tight">
      <CheckoutSkeleton />
    </StorefrontSection>
  );
}
