import { smsLogs } from "@louez/db";
import { eq, inArray, isNull, or } from "drizzle-orm";

/**
 * Where an SMS's log row says its cost went (`sms_logs.credit_source`):
 *
 * - `plan`: within the month's included SMS.
 * - `topup_pending`: paid from the prepaid balance, its credit not taken yet
 *   (an outbox row takes it: lib/sms/delivery.ts).
 * - `topup_unpaid`: its credit found the balance empty (two SMS passed the
 *   quota check for the last credit at once); the next top-up takes it.
 * - `topup`: its prepaid credit is taken.
 */
export const SMS_CREDIT_SOURCE = {
  plan: "plan",
  topupPending: "topup_pending",
  topupUnpaid: "topup_unpaid",
  topup: "topup",
} as const;

/**
 * The log rows the plan paid for: what the monthly quota counts. Rows written
 * before the credit source was recorded have none, and were plan SMS.
 */
export const paidByPlan = () =>
  or(isNull(smsLogs.creditSource), eq(smsLogs.creditSource, SMS_CREDIT_SOURCE.plan));

/** The log rows whose prepaid credit is still owed: what the balance cannot spend again. */
export const owesPrepaidCredit = () =>
  inArray(smsLogs.creditSource, [SMS_CREDIT_SOURCE.topupPending, SMS_CREDIT_SOURCE.topupUnpaid]);
