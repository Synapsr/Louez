/**
 * What the sample approvals script writes, loaded by `approvals.ts` only once
 * its guard (`checkSampleDatabase`) let it: nothing here is loaded, and
 * nothing connects to a database, before that. It connects on a pool of its
 * own, opened with the fields the guard checked (`SampleConnection`), never
 * with DATABASE_URL: the app's own pool is never queried here.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import * as schema from "@louez/db/schema";
import {
  apiHandoffs,
  apiKeys,
  customers,
  reservations,
  storeMembers,
  stores,
  users,
  type ApiApprovalPayload,
} from "@louez/db/schema";
import { handoffPath, linkExpiry } from "@louez/api/services/handoffs";

import type { SampleConnection } from "./approvals-guard";

/** The database the samples are written to: a pool on exactly `connection`'s fields. */
export function openSampleDatabase(connection: SampleConnection) {
  const pool = mysql.createPool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    connectionLimit: 1,
    // Drizzle writes every timestamp in UTC, as the app's pool does.
    timezone: "Z",
  });
  return { pool, db: drizzle(pool, { schema, mode: "default" }) };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const random = () => sha256(randomBytes(32).toString("hex"));

function fail(message: string): never {
  console.error(`\x1b[31mERROR: ${message}\x1b[0m`);
  process.exit(1);
}

interface Sample {
  label: string;
  procedure: string;
  payload: ApiApprovalPayload;
}

/**
 * Writes the samples in the store `storeRef` (its id or slug) for its owner
 * `email`, and prints their page URLs. Only `approvals.ts` calls it, once its
 * guard let it.
 */
export async function writeSampleApprovals(
  connection: SampleConnection,
  email: string,
  storeRef: string,
) {
  const { pool, db } = openSampleDatabase(connection);
  try {
    await writeSamples(db, email, storeRef);
  } finally {
    await pool.end();
  }
}

async function writeSamples(
  db: ReturnType<typeof openSampleDatabase>["db"],
  email: string,
  storeRef: string,
) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) fail(`No user with the e-mail ${email}.`);
  const [store] = await db
    .select({ id: stores.id, name: stores.name, settings: stores.settings })
    .from(stores)
    .where(or(eq(stores.id, storeRef), eq(stores.slug, storeRef)))
    .limit(1);
  if (!store) fail(`No store with the id or slug ${storeRef}.`);
  const [member] = await db
    .select({ role: storeMembers.role })
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, store.id), eq(storeMembers.userId, user.id)));
  // A member removed is an owner's to approve; an owner may approve all three.
  if (member?.role !== "owner") fail(`${email} is not an owner of “${store.name}”.`);

  const currency = (store.settings?.currency ?? "EUR").toUpperCase();
  // The store's latest reservation, when it has one, so the samples name a real one.
  const [latest] = await db
    .select({
      id: reservations.id,
      number: reservations.number,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
      totalAmount: reservations.totalAmount,
      firstName: customers.firstName,
      lastName: customers.lastName,
      email: customers.email,
    })
    .from(reservations)
    .leftJoin(customers, eq(customers.id, reservations.customerId))
    .where(eq(reservations.storeId, store.id))
    .orderBy(desc(reservations.createdAt))
    .limit(1);
  const reservation = {
    id: latest?.id ?? "sample_reservation_01",
    number: latest?.number ?? "1042",
    startDate: (latest?.startDate ?? new Date("2026-11-21T09:00:00.000Z")).toISOString(),
    endDate: (latest?.endDate ?? new Date("2026-11-23T18:00:00.000Z")).toISOString(),
    totalAmount: latest?.totalAmount ?? "180.00",
    customer: latest?.firstName
      ? `${latest.firstName} ${latest.lastName ?? ""}`.trim()
      : "Camille Martin",
    email: latest?.email ?? "camille.martin@example.com",
  };

  const samples: Sample[] = [
    {
      label: "A payment recorded on a reservation (money)",
      procedure: "dashboard.payments.record",
      payload: {
        input: { reservationId: reservation.id, type: "rental", amount: 120, method: "cash" },
        preview: {
          summary: `Record a rental payment of 120.00 € (cash) on reservation #${reservation.number}.`,
          details: {
            reservationId: reservation.id,
            number: reservation.number,
            type: "rental",
            amount: 120,
            method: "cash",
          },
        },
        scope: { domain: "payments", level: "write" },
        consequences: ["money"],
      },
    },
    {
      label: "A booking confirmed over the turnover buffer (stock override)",
      procedure: "dashboard.reservations.updateStatus",
      payload: {
        input: { id: reservation.id, status: "confirmed", overrideTurnoverBuffer: true },
        preview: {
          summary: `Change reservation #${reservation.number} for ${reservation.customer} (${reservation.startDate} to ${reservation.endDate}, ${reservation.totalAmount} ${currency}) from pending to confirmed. ${reservation.customer} (${reservation.email}) gets the "request accepted" message by email. Its items leave the stock for these dates. These lines fit the stock but not the 120-minute turnover buffer the store keeps between rentals, and are confirmed past it all the same: Kayak biplace, 2 asked, 1 free with the buffer. The reservation's history records it.`,
          details: {
            reservation: {
              id: reservation.id,
              number: reservation.number,
              from: "pending",
              to: "confirmed",
              startDate: reservation.startDate,
              endDate: reservation.endDate,
              totalAmount: reservation.totalAmount,
              currency,
            },
            customer: { name: reservation.customer, email: reservation.email },
            messages: [{ message: "request_accepted", channel: "email" }],
            reducesAvailability: true,
            overbooking: null,
            turnoverBuffer: {
              shortfalls: [{ product: "Kayak biplace", requested: 2, available: 1 }],
              turnoverBufferMinutes: 120,
            },
          },
        },
        scope: { domain: "reservations", level: "write" },
        consequences: ["stock_override", "customer_message"],
      },
    },
    {
      label: "A team member removed (access removed)",
      procedure: "dashboard.team.removeMember",
      payload: {
        input: { id: "sample_membership_01" },
        preview: {
          summary: `Remove Lucas Bernard (lucas.bernard@example.com) from "${store.name}". They lose access to the store at once: its customers, reservations and payments.`,
          details: {
            member: {
              id: "sample_membership_01",
              name: "Lucas Bernard",
              email: "lucas.bernard@example.com",
              role: "member",
            },
          },
        },
        scope: { domain: "team", level: "write", role: "manage_members" },
        consequences: ["access_removed"],
      },
    },
  ];

  const keyId = randomBytes(16).toString("base64url").slice(0, 21);
  await db.insert(apiKeys).values({
    id: keyId,
    storeId: store.id,
    userId: user.id,
    name: "Sample assistant",
    keyPrefix: "lz_sample",
    // The hash of a secret nobody was given: the key exists, and calls nothing.
    keyHash: random(),
    permissions: {
      reservations: "write",
      products: "none",
      customers: "read",
      categories: "none",
      payments: "write",
      analytics: "none",
      settings: "none",
      team: "write",
    },
  });

  const now = new Date();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`\nSample approvals in “${store.name}” for ${email}:\n`);
  for (const sample of samples) {
    const [created] = await db
      .insert(apiHandoffs)
      .values({
        storeId: store.id,
        kind: "operation_approval",
        subject: random(),
        procedure: sample.procedure,
        bindingHash: random(),
        payload: sample.payload,
        status: "pending",
        activeSlot: 1,
        userId: user.id,
        credentialKind: "api_key",
        credentialId: keyId,
        clientName: "Sample assistant",
        tokenHash: null,
        linkIssuedAt: now,
        expiresAt: linkExpiry("operation_approval", now),
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    console.log(`  ${sample.label}\n  ${appUrl}${handoffPath(created.id)}\n`);
  }
  console.log(
    "Open them signed in as that owner. Undecided, they lapse in 24 hours; revoking the API key “Sample assistant” ends them at once.",
  );
}

