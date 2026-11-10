import { db, mergeStoreRow, stores, type StoreJson, type StoreRowUpdate } from "@louez/db";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  withCustomerNotificationDefaults,
  type AdminReminderMode,
  type CustomerNotificationSettings,
  type NotificationSettings,
} from "@louez/types";
import type {
  GetCustomerTemplateInput,
  UpdateAdminReminderSettingsInput,
  UpdateCustomerPreferenceInput,
  UpdateCustomerTemplateInput,
  UpdateReminderSettingsInput,
  UpdateSinglePreferenceInput,
} from "@louez/validations";
import { eq } from "drizzle-orm";

import { ApiServiceError } from "./errors";

interface StoreParams {
  storeId: string;
}

interface UpdateSinglePreferenceParams extends StoreParams {
  input: UpdateSinglePreferenceInput;
}

interface UpdateCustomerPreferenceParams extends StoreParams {
  input: UpdateCustomerPreferenceInput;
}

interface CustomerTemplateParams extends StoreParams {
  input: GetCustomerTemplateInput;
}

interface UpdateCustomerTemplateParams extends StoreParams {
  input: UpdateCustomerTemplateInput;
}

interface UpdateReminderSettingsParams extends StoreParams {
  input: UpdateReminderSettingsInput;
}

interface UpdateAdminReminderSettingsParams extends StoreParams {
  input: UpdateAdminReminderSettingsInput;
}

const getNotificationSettings = async (storeId: string) => {
  const store = await db.query.stores.findFirst({
    columns: {
      notificationSettings: true,
      customerNotificationSettings: true,
    },
    where: eq(stores.id, storeId),
  });

  if (!store) {
    throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  }

  return store;
};

/**
 * Writes the notification settings from what is stored now, under the store
 * row's lock: two settings saved at once (two switches, a template and a
 * reminder) keep both changes.
 */
const mergeNotificationSettings = async (
  storeId: string,
  build: (current: StoreJson) => StoreRowUpdate,
) => {
  const saved = await mergeStoreRow(db, storeId, (current) => ({ set: build(current) }));
  if (!saved) throw new ApiServiceError("NOT_FOUND", "errors.storeNotFound");
  return { success: true } satisfies { success: true };
};

export const updateSingleNotificationPreference = async ({
  storeId,
  input,
}: UpdateSinglePreferenceParams) => {
  return mergeNotificationSettings(storeId, (store) => {
    const currentSettings: NotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...store.notificationSettings,
    };
    const currentEventSettings = currentSettings[input.eventType];
    const updatedSettings: NotificationSettings = {
      ...currentSettings,
      [input.eventType]: {
        ...currentEventSettings,
        [input.channel]: input.enabled,
      },
    };

    return { notificationSettings: updatedSettings };
  });
};

export const updateCustomerNotificationPreference = async ({
  storeId,
  input,
}: UpdateCustomerPreferenceParams) => {
  return mergeNotificationSettings(storeId, (store) => {
    const currentSettings: CustomerNotificationSettings = withCustomerNotificationDefaults(
      store.customerNotificationSettings,
    );
    const currentEventSettings = currentSettings[input.eventType];
    const updatedSettings: CustomerNotificationSettings = {
      ...currentSettings,
      [input.eventType]: {
        ...currentEventSettings,
        [input.channel]: input.enabled,
        enabled: input.enabled ? true : currentEventSettings.enabled,
      },
    };

    return { customerNotificationSettings: updatedSettings };
  });
};

export const getCustomerNotificationTemplate = async ({
  storeId,
  input,
}: CustomerTemplateParams) => {
  const store = await getNotificationSettings(storeId);
  const settings = withCustomerNotificationDefaults(store.customerNotificationSettings);

  return { template: settings.templates?.[input.eventType] ?? {} };
};

export const updateCustomerNotificationTemplate = async ({
  storeId,
  input,
}: UpdateCustomerTemplateParams) => {
  return mergeNotificationSettings(storeId, (store) => {
    const currentSettings: CustomerNotificationSettings = withCustomerNotificationDefaults(
      store.customerNotificationSettings,
    );
    const updatedSettings: CustomerNotificationSettings = {
      ...currentSettings,
      templates: {
        ...currentSettings.templates,
        [input.eventType]: input.template,
      },
    };

    return { customerNotificationSettings: updatedSettings };
  });
};

export const updateCustomerReminderSettings = async ({
  storeId,
  input,
}: UpdateReminderSettingsParams) => {
  return mergeNotificationSettings(storeId, (store) => {
    const currentSettings: CustomerNotificationSettings = withCustomerNotificationDefaults(
      store.customerNotificationSettings,
    );
    const updatedSettings: CustomerNotificationSettings = {
      ...currentSettings,
      reminderSettings: {
        pickupReminderHours: input.pickupReminderHours,
        returnReminderHours: input.returnReminderHours,
      },
    };

    return { customerNotificationSettings: updatedSettings };
  });
};

export const updateAdminNotificationReminderSettings = async ({
  storeId,
  input,
}: UpdateAdminReminderSettingsParams) => {
  return mergeNotificationSettings(storeId, (store) => {
    const currentSettings: NotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...store.notificationSettings,
    };
    const currentTiming = currentSettings.reminderSettings ?? {
      pickupReminderHours: 24,
      returnReminderHours: 24,
      mode: "per_reservation" satisfies AdminReminderMode,
      digestHour: 8,
    };
    const updatedSettings: NotificationSettings = {
      ...currentSettings,
      reminderSettings: {
        pickupReminderHours: input.pickupReminderHours,
        returnReminderHours: input.returnReminderHours,
        mode: input.mode ?? currentTiming.mode ?? "per_reservation",
        digestHour: input.digestHour ?? currentTiming.digestHour ?? 8,
      },
    };

    return { notificationSettings: updatedSettings };
  });
};
