import "./load-dotenv";

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { removeMatchingAxis, removeVariantFromStoreProducts } from "@louez/api/services";
import { db, productUnits, products, reservationItems, variantDefinitions } from "@louez/db";

type CliOptions = {
  mode: "dry-run" | "apply" | "restore";
  storeId?: string;
  backupPath?: string;
  restorePath?: string;
};

const axisSchema = z.object({ key: z.string(), label: z.string(), position: z.number() });
const backupSchema = z.object({
  createdAt: z.string(),
  database: z.string(),
  products: z.array(
    z.object({ id: z.string(), bookingAttributeAxes: z.array(axisSchema).nullable() }),
  ),
  units: z.array(
    z.object({
      id: z.string(),
      combinationKey: z.string(),
      attributes: z.record(z.string(), z.string()).nullable(),
    }),
  ),
  reservationItems: z.array(z.object({ id: z.string(), combinationKey: z.string().nullable() })),
});
type Backup = z.infer<typeof backupSchema>;

function printUsage(): void {
  console.log(`Usage:
  pnpm variants:sync-inactive -- --dry-run [--store-id <storeId>]
  pnpm variants:sync-inactive -- --apply [--store-id <storeId>] [--backup <file.json>]
  pnpm variants:sync-inactive -- --restore <file.json>

--apply writes a JSON backup of every row it is about to change before
touching anything; --restore puts those rows back from that file.
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mode: "dry-run" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--apply") options.mode = "apply";
    else if (arg === "--dry-run") options.mode = "dry-run";
    else if (arg === "--restore") {
      options.mode = "restore";
      options.restorePath = argv[++index];
    } else if (arg === "--store-id") options.storeId = argv[++index];
    else if (arg === "--backup") options.backupPath = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }
  if (options.mode === "restore" && !options.restorePath) {
    console.error("--restore needs the backup file path");
    process.exit(1);
  }
  return options;
}

/** Host and database name, so a backup is only restored where it was taken. */
const databaseTarget = (): string => {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://unknown");
  return `${url.host}${url.pathname}`;
};

async function loadInactiveDefinitions(storeId?: string) {
  const definitions = await db
    .select({
      id: variantDefinitions.id,
      storeId: variantDefinitions.storeId,
      key: variantDefinitions.key,
      label: variantDefinitions.label,
    })
    .from(variantDefinitions)
    .where(eq(variantDefinitions.isActive, false))
    .orderBy(asc(variantDefinitions.storeId), asc(variantDefinitions.position));
  return storeId ? definitions.filter((definition) => definition.storeId === storeId) : definitions;
}

/** Products of the store still carrying one of the given inactive variants. */
async function findAffectedProducts(
  storeId: string,
  variants: ReadonlyArray<{ key: string; label: string }>,
) {
  const rows = await db
    .select({ id: products.id, name: products.name, axes: products.bookingAttributeAxes })
    .from(products)
    .where(eq(products.storeId, storeId));
  return rows.filter((row) =>
    variants.some((variant) => removeMatchingAxis(row.axes, variant) !== null),
  );
}

async function snapshot(productIds: string[]): Promise<Backup> {
  if (productIds.length === 0) {
    return {
      createdAt: new Date().toISOString(),
      database: databaseTarget(),
      products: [],
      units: [],
      reservationItems: [],
    };
  }
  const [productRows, unitRows, itemRows] = await Promise.all([
    db
      .select({ id: products.id, bookingAttributeAxes: products.bookingAttributeAxes })
      .from(products)
      .where(inArray(products.id, productIds)),
    db
      .select({
        id: productUnits.id,
        combinationKey: productUnits.combinationKey,
        attributes: productUnits.attributes,
      })
      .from(productUnits)
      .where(inArray(productUnits.productId, productIds)),
    db
      .select({ id: reservationItems.id, combinationKey: reservationItems.combinationKey })
      .from(reservationItems)
      .where(
        and(
          inArray(reservationItems.productId, productIds),
          isNotNull(reservationItems.combinationKey),
        ),
      ),
  ]);
  return {
    createdAt: new Date().toISOString(),
    database: databaseTarget(),
    products: productRows,
    units: unitRows,
    reservationItems: itemRows,
  };
}

async function restore(path: string): Promise<void> {
  const backup = backupSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (backup.database !== databaseTarget()) {
    console.error(
      `Backup was taken on ${backup.database}, DATABASE_URL points to ${databaseTarget()}`,
    );
    process.exit(1);
  }
  console.log(
    `Restoring ${backup.products.length} product(s), ${backup.units.length} unit(s), ` +
      `${backup.reservationItems.length} booked line(s) from ${backup.createdAt}`,
  );
  await db.transaction(async (tx) => {
    for (const product of backup.products) {
      await tx
        .update(products)
        .set({ bookingAttributeAxes: product.bookingAttributeAxes, updatedAt: new Date() })
        .where(eq(products.id, product.id));
    }
    for (const unit of backup.units) {
      await tx
        .update(productUnits)
        .set({
          combinationKey: unit.combinationKey,
          attributes: unit.attributes,
          updatedAt: new Date(),
        })
        .where(eq(productUnits.id, unit.id));
    }
    for (const item of backup.reservationItems) {
      await tx
        .update(reservationItems)
        .set({ combinationKey: item.combinationKey })
        .where(eq(reservationItems.id, item.id));
    }
  });
  console.log("Restored");
}

/**
 * One-off migration. Before this change, switching a variant off hid it in
 * the dashboard while products kept the axis, so owners believed it was
 * gone. This applies the withdrawal they meant (axis dropped, unit values
 * cleared, units and booked lines re-keyed) to every inactive definition,
 * store by store. Since then, the switch no longer touches products: owners
 * use "Remove from products" in the variant manager instead.
 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "restore" && options.restorePath) {
    await restore(resolve(options.restorePath));
    process.exit(0);
  }

  const apply = options.mode === "apply";
  const definitions = await loadInactiveDefinitions(options.storeId);
  console.log(
    `${apply ? "Applying" : "Dry run"} on ${databaseTarget()}: ${definitions.length} inactive definition(s)`,
  );

  const storeIds = [...new Set(definitions.map((definition) => definition.storeId))];
  const affectedProductIds: string[] = [];
  for (const storeId of storeIds) {
    const variants = definitions.filter((definition) => definition.storeId === storeId);
    const affected = await findAffectedProducts(storeId, variants);
    affectedProductIds.push(...affected.map((row) => row.id));
    if (affected.length > 0) {
      console.log(
        `store ${storeId} · ${variants.map((variant) => `${variant.label} (${variant.key})`).join(", ")}`,
      );
      for (const row of affected) console.log(`  - ${row.id} ${row.name}`);
    }
  }

  if (!apply) {
    console.log(`Would update ${affectedProductIds.length} product(s)`);
    process.exit(0);
  }

  const backup = await snapshot(affectedProductIds);
  const backupPath = resolve(
    options.backupPath ?? `variant-axes-backup-${backup.createdAt.replace(/[:.]/g, "-")}.json`,
  );
  await writeFile(backupPath, JSON.stringify(backup, null, 2));
  console.log(
    `Backup written to ${backupPath} (${backup.units.length} unit(s), ` +
      `${backup.reservationItems.length} booked line(s)); restore with --restore <file>`,
  );

  let updatedProducts = 0;
  for (const definition of definitions) {
    const variant = { key: definition.key, label: definition.label };
    const result = await db.transaction((tx) =>
      removeVariantFromStoreProducts(tx, { storeId: definition.storeId, variant }),
    );
    updatedProducts += result.productIds.length;
    if (result.productIds.length > 0) {
      console.log(
        `store ${definition.storeId} · ${definition.label}: ${result.productIds.length} product(s), ` +
          `${result.unitsRekeyed} unit(s), ${result.reservationItemsRekeyed} booked line(s) re-keyed`,
      );
    }
  }
  console.log(`Updated ${updatedProducts} product(s)`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
