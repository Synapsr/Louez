import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// The notification settings are two JSON columns that each switch, template
// and reminder patches: saves that run at once must keep each other's change.

const STORE = "ns_store_a_000000001";

describe("notification settings writes (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orm: typeof import("drizzle-orm");
  let service: typeof import("./notification-settings");

  before(async () => {
    database = await createTestDatabase("api_notification_settings");
    louezDb = await import("@louez/db");
    orm = await import("drizzle-orm");
    service = await import("./notification-settings");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.stores);
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: "owner", name: "Notify", slug: "ns-notify" });
  });

  async function stored() {
    const [row] = await louezDb.db
      .select({
        notificationSettings: louezDb.stores.notificationSettings,
        customerNotificationSettings: louezDb.stores.customerNotificationSettings,
      })
      .from(louezDb.stores)
      .where(orm.eq(louezDb.stores.id, STORE));
    return row;
  }

  test("two switches saved at once keep both", async () => {
    await raceOnLockedRow<unknown>(database, { table: "stores", id: STORE }, [
      () =>
        service.updateSingleNotificationPreference({
          storeId: STORE,
          input: { eventType: "reservation_new", channel: "sms", enabled: true },
        }),
      () =>
        service.updateSingleNotificationPreference({
          storeId: STORE,
          input: { eventType: "reservation_cancelled", channel: "discord", enabled: true },
        }),
      () =>
        service.updateAdminNotificationReminderSettings({
          storeId: STORE,
          input: { pickupReminderHours: 48, returnReminderHours: 12 },
        }),
    ]);
    const { notificationSettings } = (await stored()) ?? {};
    assert.equal(notificationSettings?.reservation_new.sms, true);
    assert.equal(notificationSettings?.reservation_cancelled.discord, true);
    assert.equal(notificationSettings?.reminderSettings?.pickupReminderHours, 48);
  });

  test("a customer template and a reminder saved at once keep both", async () => {
    await raceOnLockedRow<unknown>(database, { table: "stores", id: STORE }, [
      () =>
        service.updateCustomerNotificationTemplate({
          storeId: STORE,
          input: { eventType: "customer_request_accepted", template: { subject: "Bon ride" } },
        }),
      () =>
        service.updateCustomerReminderSettings({
          storeId: STORE,
          input: { pickupReminderHours: 6, returnReminderHours: 3 },
        }),
      () =>
        service.updateCustomerNotificationPreference({
          storeId: STORE,
          input: { eventType: "customer_reservation_confirmed", channel: "sms", enabled: true },
        }),
    ]);
    const { customerNotificationSettings } = (await stored()) ?? {};
    assert.equal(
      customerNotificationSettings?.templates?.customer_request_accepted?.subject,
      "Bon ride",
    );
    assert.equal(customerNotificationSettings?.reminderSettings?.pickupReminderHours, 6);
    assert.equal(customerNotificationSettings?.customer_reservation_confirmed.sms, true);
  });

  test("an event the saved settings predate switches from its default", async () => {
    const { DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS } =
      require("@louez/types") as typeof import("@louez/types");
    // Saved before the store-cancellation message existed.
    const { customer_reservation_cancelled: _missing, ...saved } =
      DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS;
    await louezDb.db
      .update(louezDb.stores)
      .set({ customerNotificationSettings: saved as never })
      .where(orm.eq(louezDb.stores.id, STORE));

    await service.updateCustomerNotificationPreference({
      storeId: STORE,
      input: { eventType: "customer_reservation_cancelled", channel: "email", enabled: false },
    });
    const { customerNotificationSettings } = (await stored()) ?? {};
    assert.deepEqual(customerNotificationSettings?.customer_reservation_cancelled, {
      enabled: true,
      email: false,
      sms: false,
    });
    assert.deepEqual(
      customerNotificationSettings?.customer_request_accepted,
      DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS.customer_request_accepted,
    );
  });

  test("an unknown store is not found", async () => {
    await assert.rejects(
      service.updateCustomerReminderSettings({
        storeId: "ns_missing_000000001",
        input: { pickupReminderHours: 6, returnReminderHours: 3 },
      }),
      /storeNotFound/,
    );
  });
});
