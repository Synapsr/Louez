import { categories, db, productCategories, products } from '@louez/db';
import { categorySchema, isOwnedImageUrl } from '@louez/validations';
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import { dashboardProcedure } from '../../procedures';

const categoryOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  productCount: z.number().optional(),
});

const list = dashboardProcedure
  .output(z.array(categoryOutputSchema))
  .handler(async ({ context }) => {
    return db
      .select({
        id: categories.id,
        name: categories.name,
        description: categories.description,
        imageUrl: categories.imageUrl,
        productCount: count(productCategories.productId),
      })
      .from(categories)
      .leftJoin(
        productCategories,
        eq(productCategories.categoryId, categories.id),
      )
      .where(eq(categories.storeId, context.store.id))
      .groupBy(
        categories.id,
        categories.name,
        categories.description,
        categories.imageUrl,
        categories.order,
      )
      .orderBy(asc(categories.order), asc(categories.name));
  });

const create = dashboardProcedure
  .input(categorySchema)
  .output(categoryOutputSchema)
  .handler(async ({ context, input }) => {
    const name = input.name;
    const description = input.description?.trim() || null;
    const imageUrl = input.imageUrl || null;

    if (
      imageUrl &&
      !isOwnedImageUrl(imageUrl, `${context.store.id}/categories`)
    ) {
      throw new ORPCError('BAD_REQUEST', { message: 'errors.invalidData' });
    }

    // Idempotent by name: return the existing category instead of duplicating
    const existing = await db
      .select({
        id: categories.id,
        name: categories.name,
        description: categories.description,
        imageUrl: categories.imageUrl,
      })
      .from(categories)
      .where(
        and(
          eq(categories.storeId, context.store.id),
          eq(sql`LOWER(${categories.name})`, name.toLowerCase()),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return existing[0];
    }

    const [{ maxOrder }] = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${categories.order}), 0)` })
      .from(categories)
      .where(eq(categories.storeId, context.store.id));

    const [created] = await db
      .insert(categories)
      .values({
        storeId: context.store.id,
        name,
        description,
        imageUrl,
        order: maxOrder + 1,
      })
      .$returningId();

    return { id: created.id, name, description, imageUrl, productCount: 0 };
  });

const update = dashboardProcedure
  .input(categorySchema.extend({ id: z.string() }))
  .output(categoryOutputSchema)
  .handler(async ({ context, input }) => {
    const category = await db.query.categories.findFirst({
      columns: { id: true, description: true, imageUrl: true },
      where: and(
        eq(categories.id, input.id),
        eq(categories.storeId, context.store.id),
      ),
    });

    if (!category) {
      throw new ORPCError('NOT_FOUND', { message: 'errors.categoryNotFound' });
    }

    const description =
      input.description === undefined
        ? category.description
        : input.description?.trim() || null;
    const imageUrl =
      input.imageUrl === undefined ? category.imageUrl : input.imageUrl || null;

    if (
      imageUrl &&
      imageUrl !== category.imageUrl &&
      !isOwnedImageUrl(imageUrl, `${context.store.id}/categories`)
    ) {
      throw new ORPCError('BAD_REQUEST', { message: 'errors.invalidData' });
    }

    const duplicate = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.storeId, context.store.id),
          ne(categories.id, input.id),
          eq(sql`LOWER(${categories.name})`, input.name.toLowerCase()),
        ),
      )
      .limit(1);

    if (duplicate[0]) {
      throw new ORPCError('CONFLICT', { message: 'errors.invalidData' });
    }

    await db
      .update(categories)
      .set({
        name: input.name,
        description,
        imageUrl,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(categories.id, input.id),
          eq(categories.storeId, context.store.id),
        ),
      );

    return { id: input.id, name: input.name, description, imageUrl };
  });

const remove = dashboardProcedure
  .input(
    z.object({
      id: z.string(),
      replacementCategoryId: z.string().nullable().optional(),
    }),
  )
  .output(z.object({ id: z.string() }))
  .handler(async ({ context, input }) => {
    const replacementCategoryId = input.replacementCategoryId ?? null;
    const category = await db.query.categories.findFirst({
      columns: { id: true },
      where: and(
        eq(categories.id, input.id),
        eq(categories.storeId, context.store.id),
      ),
    });

    if (!category) {
      throw new ORPCError('NOT_FOUND', { message: 'errors.categoryNotFound' });
    }

    if (replacementCategoryId === input.id) {
      throw new ORPCError('BAD_REQUEST', { message: 'errors.invalidData' });
    }

    if (replacementCategoryId) {
      const replacement = await db.query.categories.findFirst({
        columns: { id: true },
        where: and(
          eq(categories.id, replacementCategoryId),
          eq(categories.storeId, context.store.id),
        ),
      });

      if (!replacement) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'errors.categoryNotFound',
        });
      }
    }

    await db.transaction(async (tx) => {
      const affectedLinks = await tx
        .select({
          productId: productCategories.productId,
          position: productCategories.position,
        })
        .from(productCategories)
        .innerJoin(products, eq(products.id, productCategories.productId))
        .where(
          and(
            eq(products.storeId, context.store.id),
            eq(productCategories.categoryId, input.id),
          ),
        );

      await tx
        .delete(productCategories)
        .where(eq(productCategories.categoryId, input.id));

      const affectedIds = affectedLinks.map((link) => link.productId);
      if (affectedIds.length > 0) {
        if (replacementCategoryId) {
          const existingReplacementLinks =
            await tx.query.productCategories.findMany({
              columns: { productId: true },
              where: and(
                inArray(productCategories.productId, affectedIds),
                eq(productCategories.categoryId, replacementCategoryId),
              ),
            });
          const alreadyLinked = new Set(
            existingReplacementLinks.map((link) => link.productId),
          );
          const replacementLinks = affectedLinks
            .filter((link) => !alreadyLinked.has(link.productId))
            .map((link) => ({
              productId: link.productId,
              categoryId: replacementCategoryId,
              position: link.position,
            }));

          if (replacementLinks.length > 0) {
            await tx.insert(productCategories).values(replacementLinks);
          }
        }

        const remainingLinks = await tx.query.productCategories.findMany({
          where: inArray(productCategories.productId, affectedIds),
          orderBy: [productCategories.position],
        });
        const replacementByProduct = new Map<string, string>();

        for (const link of remainingLinks) {
          if (!replacementByProduct.has(link.productId)) {
            replacementByProduct.set(link.productId, link.categoryId);
          }
        }

        for (const productId of affectedIds) {
          await tx
            .update(products)
            .set({
              categoryId:
                replacementCategoryId ??
                replacementByProduct.get(productId) ??
                null,
            })
            .where(
              and(
                eq(products.id, productId),
                eq(products.storeId, context.store.id),
                eq(products.categoryId, input.id),
              ),
            );
        }
      }

      await tx
        .delete(categories)
        .where(
          and(
            eq(categories.id, input.id),
            eq(categories.storeId, context.store.id),
          ),
        );
    });

    return { id: input.id };
  });

/**
 * Dashboard categories router
 */
export const dashboardCategoriesRouter = {
  list,
  create,
  update,
  delete: remove,
};
