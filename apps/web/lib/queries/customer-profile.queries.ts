import { updateCommunicationPreferences } from "@/app/(storefront)/[slug]/account/communication-actions";
import { updateCustomerProfile } from "@/app/(storefront)/[slug]/account/profile-actions";

export const customerProfileMutations = {
  communications: () => ({ mutationFn: updateCommunicationPreferences }),
  update: () => ({ mutationFn: updateCustomerProfile }),
};
