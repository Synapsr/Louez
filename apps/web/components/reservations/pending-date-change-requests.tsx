import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db, reservations, reservationActivity } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";

export const PendingDateChangeRequests = async () => {
  const store = await getCurrentStore();
  if (!store) return null;
  const requests = await db
    .select({
      id: reservationActivity.id,
      reservationId: reservations.id,
      number: reservations.number,
    })
    .from(reservationActivity)
    .innerJoin(reservations, eq(reservations.id, reservationActivity.reservationId))
    .where(
      and(
        eq(reservations.storeId, store.id),
        inArray(reservations.status, ["confirmed", "ongoing"]),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.kind')) = 'return_date_request'`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.status')) = 'pending'`,
      ),
    )
    .orderBy(desc(reservationActivity.createdAt));
  if (!requests.length) return null;
  const t = await getTranslations("storefront.account");
  return (
    <section className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <h2 className="font-semibold">
        {t("dateChange.reviewTitle")} · {requests.length}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-3">
        {requests.map((request) => (
          <li key={request.id}>
            <Link
              className="text-sm font-medium underline underline-offset-4"
              href={`/dashboard/reservations/${request.reservationId}`}
            >
              {t("reservationNumber", { number: request.number })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};
