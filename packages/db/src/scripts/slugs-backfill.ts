import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import { and, asc, eq, isNull } from "drizzle-orm";

import { pickUniqueSlug, slugify } from "../slug";

type CliOptions = {
  apply: boolean;
  storeId?: string;
};

type BackfillReport = {
  productsScanned: number;
  productsUpdated: number;
  categoriesScanned: number;
  categoriesUpdated: number;
};

function printUsage(): void {
  console.log(`Usage:
  pnpm slugs:backfill -- --dry-run
  pnpm slugs:backfill -- --apply
  pnpm slugs:backfill -- --apply --store-id <storeId>
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // pnpm forwards the "--" separator itself on some versions.
    if (arg === "--") continue;
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--store-id") options.storeId = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  return options;
}

/**
 * Gives every product and category without a slug one derived from its
 * name, unique within its store, oldest rows first so the plain slug goes
 * to the original and the numbered ones to later duplicates.
 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { db, products, categories } = await import("../index");
  const report: BackfillReport = {
    productsScanned: 0,
    productsUpdated: 0,
    categoriesScanned: 0,
    categoriesUpdated: 0,
  };

  for (const table of [products, categories] as const) {
    const isProducts = table === products;
    const rows = await db
      .select({ id: table.id, storeId: table.storeId, name: table.name, slug: table.slug })
      .from(table)
      .where(options.storeId ? eq(table.storeId, options.storeId) : undefined)
      .orderBy(asc(table.createdAt));

    const takenByStore = new Map<string, Set<string>>();
    for (const row of rows) {
      const taken = takenByStore.get(row.storeId) ?? new Set<string>();
      if (row.slug) taken.add(row.slug);
      takenByStore.set(row.storeId, taken);
    }

    for (const row of rows) {
      if (isProducts) report.productsScanned += 1;
      else report.categoriesScanned += 1;
      if (row.slug) continue;

      const taken = takenByStore.get(row.storeId) ?? new Set<string>();
      const slug = pickUniqueSlug(slugify(row.name), taken, isProducts ? "produit" : "categorie");
      taken.add(slug);
      takenByStore.set(row.storeId, taken);

      if (options.apply) {
        await db
          .update(table)
          .set({ slug })
          .where(and(eq(table.id, row.id), isNull(table.slug)));
      }
      if (isProducts) report.productsUpdated += 1;
      else report.categoriesUpdated += 1;
    }
  }

  console.log(JSON.stringify({ mode: options.apply ? "apply" : "dry-run", ...report }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
