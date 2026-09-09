import "server-only";

import { and, eq } from "drizzle-orm";
import { customerCommunicationPreferences, db } from "@louez/db";

export const getCustomerReminderPreferences = async (storeId: string, customerId: string) => {
  const preferences = await db.query.customerCommunicationPreferences.findFirst({
    columns: { emailReminders: true, smsReminders: true },
    where: and(
      eq(customerCommunicationPreferences.storeId, storeId),
      eq(customerCommunicationPreferences.customerId, customerId),
    ),
  });
  return preferences ?? { emailReminders: true, smsReminders: true };
};
