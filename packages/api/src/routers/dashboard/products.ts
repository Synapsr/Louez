import { z } from "zod";
import { ORPCError } from "@orpc/server";

import { dashboardProcedure } from "../../procedures";
import {
  PRODUCT_ACTIVITY_PAGE_SIZE,
  getProductUnitActivityPage,
} from "../../services/product-activity";
import {
  DASHBOARD_PRODUCT_STATUSES,
  getDashboardProductsList,
} from "../../services/products-dashboard";
import {
  PRODUCT_UNIT_DOWNTIME_REASONS,
  PRODUCT_UNIT_DOWNTIME_STATUSES,
  PRODUCT_UNIT_EVENT_TYPES,
  getProductUnitHistory,
} from "../../services/product-unit-history";

const productListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  images: z.array(z.string()).nullable(),
  price: z.string(),
  deposit: z.string().nullable(),
  quantity: z.number(),
  stockKind: z.enum(["returnable", "consumable", "untracked"]),
  status: z.enum(DASHBOARD_PRODUCT_STATUSES).nullable(),
  category: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable(),
});

const productCountsSchema = z.object({
  all: z.number(),
  active: z.number(),
  draft: z.number(),
  archived: z.number(),
});

const list = dashboardProcedure
  .input(
    z.object({
      status: z.enum(["all", ...DASHBOARD_PRODUCT_STATUSES]).optional(),
      /** Empty means "all categories"; a product matching any id is kept. */
      categoryIds: z.array(z.string().min(1)).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
  )
  .output(
    z.object({
      products: z.array(productListItemSchema),
      counts: productCountsSchema,
    }),
  )
  .handler(({ context, input }) =>
    getDashboardProductsList({
      storeId: context.store.id,
      status: input.status,
      categoryIds: input.categoryIds,
      limit: input.limit,
    }),
  );

const activityCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string(),
});

const activityItemSchema = z.object({
  id: z.string(),
  productUnitId: z.string().nullable(),
  identifierSnapshot: z.string().nullable(),
  type: z.string(),
  actorUserId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});

const activity = dashboardProcedure
  .input(
    z.object({
      productId: z.string().min(1),
      cursor: activityCursorSchema.optional(),
      limit: z.number().int().min(1).max(50).default(PRODUCT_ACTIVITY_PAGE_SIZE),
    }),
  )
  .output(
    z.object({
      items: z.array(activityItemSchema),
      nextCursor: activityCursorSchema.nullable(),
    }),
  )
  .handler(({ context, input }) =>
    getProductUnitActivityPage({
      storeId: context.store.id,
      productId: input.productId,
      cursor: input.cursor,
      limit: input.limit,
    }),
  );

const unitTimelineEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("event"),
    id: z.string(),
    type: z.enum(PRODUCT_UNIT_EVENT_TYPES),
    actorUserId: z.string().nullable(),
    actorName: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("assignment"),
    id: z.string(),
    type: z.literal("assigned"),
    reservationId: z.string(),
    reservationNumber: z.string(),
    reservationItemId: z.string(),
    identifierSnapshot: z.string(),
    customerName: z.string().nullable(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    createdAt: z.string().datetime(),
  }),
]);

const unitHistory = dashboardProcedure
  .input(z.object({ unitId: z.string().min(1) }))
  .output(
    z.object({
      timeline: z.array(unitTimelineEntrySchema),
      downtimes: z.array(
        z.object({
          id: z.string(),
          reason: z.enum(PRODUCT_UNIT_DOWNTIME_REASONS),
          startsAt: z.string().datetime(),
          endsAt: z.string().datetime().nullable(),
          note: z.string().nullable(),
          status: z.enum(PRODUCT_UNIT_DOWNTIME_STATUSES),
        }),
      ),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      const history = await getProductUnitHistory({
        storeId: context.store.id,
        unitId: input.unitId,
      });

      if (!history) {
        throw new ORPCError("NOT_FOUND", { message: "errors.notFound" });
      }

      return history;
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error;
      }

      console.error("Error loading product unit history:", error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "errors.generic",
      });
    }
  });

export const dashboardProductsRouter = {
  list,
  activity,
  unitHistory,
};
