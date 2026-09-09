import type { CustomerNotificationEventType } from "@louez/types";

export interface CustomerReminderPreferences {
  emailReminders: boolean;
  smsReminders: boolean;
}

export const isCustomerReminder = (event: CustomerNotificationEventType): boolean =>
  event === "customer_reminder_pickup" || event === "customer_reminder_return";

export const resolveCustomerReminderChannels = (
  event: CustomerNotificationEventType,
  channels: { email: boolean; sms: boolean },
  preferences: CustomerReminderPreferences | null,
) => ({
  email: channels.email && (!isCustomerReminder(event) || (preferences?.emailReminders ?? true)),
  sms: channels.sms && (!isCustomerReminder(event) || (preferences?.smsReminders ?? true)),
});
