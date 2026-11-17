"use server";

import { db } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { customers, reservations } from "@louez/db";
import { eq, and, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { customerSchema, type CustomerInput } from "@louez/validations";
import { notifyCustomerCreated } from "@/lib/discord/platform-notifications";

async function getStoreId() {
  const store = await getCurrentStore();

  if (!store) {
    throw new Error("errors.storeNotFound");
  }

  return store.id;
}

/**
 * Company identifiers as they must be persisted.
 *
 * The scheme is always derived from the customer's country — never read from
 * the submitted payload — so it can't contradict the number it labels, and
 * both identifiers are dropped when the customer is not a business. A number
 * that doesn't match its country's format is kept as typed but gets no scheme:
 * the invoice then degrades to B2C instead of being transmitted with a bogus
 * identifier.
 */
function resolveCustomerCompanyFields(validated: CustomerInput) {
  if (validated.customerType !== "business") {
    return { companyNumber: null, companyNumberScheme: null, vatNumber: null };
  }

  const vatNumber = validated.vatNumber?.replace(/[\s-]/g, "") ?? "";

  return {
    companyNumber: null,
    companyNumberScheme: null,
    vatNumber: vatNumber.length > 0 ? vatNumber : null,
  };
}

export async function createCustomer(data: CustomerInput) {
  try {
    const store = await getCurrentStore();
    if (!store) return { error: "errors.storeNotFound" };

    const validated = customerSchema.parse(data);

    const email = validated.email?.trim() || null;
    const firstName = validated.firstName?.trim() || null;
    const lastName = validated.lastName?.trim() || null;

    // Email is optional for all customer types, but remains unique when provided.
    const existingCustomer = email
      ? await db.query.customers.findFirst({
          where: and(eq(customers.storeId, store.id), eq(customers.email, email)),
        })
      : null;

    if (existingCustomer) {
      return { error: "errors.emailAlreadyExists" };
    }

    const [customer] = await db
      .insert(customers)
      .values({
        storeId: store.id,
        ...validated,
        email,
        firstName,
        lastName,
        phone: validated.phone?.trim() || null,
        discountPercent: Math.min(100, Math.max(0, Math.round(validated.discountPercent ?? 0))),
        ...resolveCustomerCompanyFields(validated),
      })
      .$returningId();

    notifyCustomerCreated(
      { id: store.id, name: store.name, slug: store.slug },
      {
        name:
          validated.customerType === "business"
            ? (validated.companyName?.trim() ?? "")
            : [firstName, lastName].filter(Boolean).join(" "),
        email,
      },
    ).catch(() => {});

    revalidatePath("/dashboard/customers");
    return { success: true, customerId: customer.id };
  } catch (error) {
    console.error("Error creating customer:", error);
    return { error: "errors.createCustomerError" };
  }
}

export async function updateCustomer(customerId: string, data: CustomerInput) {
  try {
    const storeId = await getStoreId();
    const validated = customerSchema.parse(data);

    // Check if customer exists and belongs to store
    const existingCustomer = await db.query.customers.findFirst({
      where: and(eq(customers.id, customerId), eq(customers.storeId, storeId)),
    });

    if (!existingCustomer) {
      return { error: "errors.customerNotFound" };
    }

    // Check if another customer with same email exists
    const email = validated.email?.trim() || null;
    if (email && email !== existingCustomer.email) {
      const emailExists = await db.query.customers.findFirst({
        where: and(eq(customers.storeId, storeId), eq(customers.email, email)),
      });

      if (emailExists) {
        return { error: "errors.emailAlreadyExists" };
      }
    }

    await db
      .update(customers)
      .set({
        ...validated,
        email,
        firstName: validated.firstName?.trim() || null,
        lastName: validated.lastName?.trim() || null,
        phone: validated.phone?.trim() || null,
        discountPercent: Math.min(100, Math.max(0, Math.round(validated.discountPercent ?? 0))),
        ...resolveCustomerCompanyFields(validated),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId));

    revalidatePath("/dashboard/customers");
    revalidatePath(`/dashboard/customers/${customerId}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating customer:", error);
    return { error: "errors.updateCustomerError" };
  }
}

export async function deleteCustomer(customerId: string) {
  try {
    const storeId = await getStoreId();

    // Check if customer exists and belongs to store
    const existingCustomer = await db.query.customers.findFirst({
      where: and(eq(customers.id, customerId), eq(customers.storeId, storeId)),
    });

    if (!existingCustomer) {
      return { error: "errors.customerNotFound" };
    }

    // Check if customer has reservations
    const reservationCount = await db
      .select({ count: count() })
      .from(reservations)
      .where(eq(reservations.customerId, customerId));

    if (reservationCount[0]?.count > 0) {
      return { error: "errors.customerHasReservations" };
    }

    await db.delete(customers).where(eq(customers.id, customerId));

    revalidatePath("/dashboard/customers");
    return { success: true };
  } catch (error) {
    console.error("Error deleting customer:", error);
    return { error: "errors.deleteCustomerError" };
  }
}

export async function updateCustomerNotes(customerId: string, notes: string) {
  try {
    const storeId = await getStoreId();

    // Check if customer exists and belongs to store
    const existingCustomer = await db.query.customers.findFirst({
      where: and(eq(customers.id, customerId), eq(customers.storeId, storeId)),
    });

    if (!existingCustomer) {
      return { error: "errors.customerNotFound" };
    }

    await db
      .update(customers)
      .set({
        notes,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId));

    revalidatePath(`/dashboard/customers/${customerId}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating customer notes:", error);
    return { error: "errors.updateNotesError" };
  }
}
