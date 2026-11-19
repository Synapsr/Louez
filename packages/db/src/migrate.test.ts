import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  findMissingSchemaColumnHealStatements,
  getExpectedSchemaTablesAndColumns,
  shouldPreSkipPendingMigration,
  splitSqlStatements,
} from "./migrate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_FOLDER = path.join(__dirname, "migrations");

const NON_COLUMN_KEYWORDS = new Set([
  "primary",
  "unique",
  "key",
  "index",
  "constraint",
  "foreign",
  "check",
  "fulltext",
  "spatial",
]);

/**
 * Replays all committed SQL migrations to compute the resulting set of tables
 * and columns created by the migration history.
 */
function replayMigrationsSchema(
  migrations: ReturnType<typeof readMigrationFiles>,
): Map<string, Set<string>> {
  const migratedTables = new Map<string, Set<string>>();

  for (const migration of migrations) {
    const statements = splitSqlStatements(migration.sql);
    for (const stmt of statements) {
      const createMatch = stmt.match(
        /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*)\)/i,
      );
      if (createMatch) {
        const tableName = createMatch[1].toLowerCase();
        const body = createMatch[2];
        const cols = migratedTables.get(tableName) ?? new Set<string>();
        for (const line of body.split(/\r?\n/)) {
          const trimmed = line.trim();
          const colMatch = trimmed.match(/^[`"]([^`"]+)[`"]\s+/);
          if (colMatch) {
            cols.add(colMatch[1].toLowerCase());
          }
        }
        migratedTables.set(tableName, cols);
        continue;
      }

      const dropTableMatch = stmt.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i);
      if (dropTableMatch) {
        migratedTables.delete(dropTableMatch[1].toLowerCase());
        continue;
      }

      const renameTableMatch = stmt.match(
        /^RENAME\s+TABLE\s+[`"]?(\w+)[`"]?\s+TO\s+[`"]?(\w+)[`"]?/i,
      );
      if (renameTableMatch) {
        const oldName = renameTableMatch[1].toLowerCase();
        const newName = renameTableMatch[2].toLowerCase();
        const existingCols = migratedTables.get(oldName);
        if (existingCols) {
          migratedTables.delete(oldName);
          migratedTables.set(newName, existingCols);
        }
        continue;
      }

      // Match direct or dynamic-SQL ALTER TABLE statements (e.g. 0031_whole_wraith.sql)
      for (const alterMatch of stmt.matchAll(
        /ALTER\s+TABLE\s+[`"]?(\w+)[`"]?\s+([^\n;']+)/gi,
      )) {
        const tableName = alterMatch[1].toLowerCase();
        const action = alterMatch[2];
        const cols = migratedTables.get(tableName) ?? new Set<string>();
        migratedTables.set(tableName, cols);

        for (const addMatch of action.matchAll(
          /ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi,
        )) {
          const kw = addMatch[1].toLowerCase();
          if (!NON_COLUMN_KEYWORDS.has(kw)) {
            cols.add(kw);
          }
        }
        for (const dropCol of action.matchAll(/DROP\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?/gi)) {
          const kw = dropCol[1].toLowerCase();
          if (!NON_COLUMN_KEYWORDS.has(kw)) {
            cols.delete(kw);
          }
        }
        for (const renCol of action.matchAll(
          /RENAME\s+COLUMN\s+[`"]?(\w+)[`"]?\s+TO\s+[`"]?(\w+)[`"]?/gi,
        )) {
          cols.delete(renCol[1].toLowerCase());
          cols.add(renCol[2].toLowerCase());
        }
        for (const chgCol of action.matchAll(
          /CHANGE\s+(?:COLUMN\s+)?[`"]?(\w+)[`"]?\s+[`"]?(\w+)[`"]?/gi,
        )) {
          cols.delete(chgCol[1].toLowerCase());
          cols.add(chgCol[2].toLowerCase());
        }
      }
    }
  }

  return migratedTables;
}

describe("database migrations & schema parity", () => {
  it("registers every SQL migration file in meta/_journal.json in strictly increasing order", () => {
    const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
    };

    const sqlFiles = fs
      .readdirSync(MIGRATIONS_FOLDER)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => file.replace(/\.sql$/, ""))
      .sort();

    const journalTags = journal.entries.map((entry) => entry.tag);
    assert.deepEqual(
      [...journalTags].sort(),
      sqlFiles,
      "Every .sql file in packages/db/src/migrations must be listed in meta/_journal.json",
    );

    const seenTags = new Set<string>();
    journal.entries.forEach((entry) => {
      assert.ok(!seenTags.has(entry.tag), `Duplicate journal tag: ${entry.tag}`);
      seenTags.add(entry.tag);
      assert.ok(
        Number.isFinite(entry.when) && entry.when > 0,
        `Journal entry ${entry.tag} must have a positive timestamp`,
      );
    });

    // Enforce strictly sequential idx and increasing timestamps for all modern migrations (idx >= 80)
    const modernEntries = journal.entries.filter((entry) => entry.idx >= 80);
    for (let i = 1; i < modernEntries.length; i++) {
      const prev = modernEntries[i - 1]!;
      const curr = modernEntries[i]!;
      assert.equal(
        curr.idx,
        prev.idx + 1,
        `Journal entry ${curr.tag} must have sequential idx ${prev.idx + 1}`,
      );
      assert.ok(
        curr.when > prev.when,
        `Journal entry ${curr.tag} timestamp (${curr.when}) must be greater than ${prev.tag} (${prev.when})`,
      );
    }
  });

  it("ensures every table and column in schema.ts is created by the SQL migrations", () => {
    const allMigrations = readMigrationFiles({
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsTable: "__drizzle_migrations",
    });
    const migratedTables = replayMigrationsSchema(allMigrations);
    const expectedSchema = getExpectedSchemaTablesAndColumns();

    assert.ok(expectedSchema.size > 0, "Expected Drizzle schema to expose tables");

    const missingTables: string[] = [];
    const missingColumns: string[] = [];

    for (const [tableName, columns] of expectedSchema.entries()) {
      const migratedColumns = migratedTables.get(tableName);
      if (!migratedColumns) {
        missingTables.push(tableName);
        continue;
      }
      for (const columnName of columns) {
        if (!migratedColumns.has(columnName)) {
          missingColumns.push(`${tableName}.${columnName}`);
        }
      }
    }

    assert.deepEqual(
      missingTables,
      [],
      `Tables defined in schema.ts but missing from SQL migrations: ${missingTables.join(", ")}`,
    );
    assert.deepEqual(
      missingColumns,
      [],
      `Columns defined in schema.ts but missing from SQL migrations: ${missingColumns.join(", ")}`,
    );
  });
});

describe("shouldPreSkipPendingMigration", () => {
  it("does NOT skip a multi-statement migration when only some columns exist (production regression)", () => {
    const multiStatementSql = [
      "ALTER TABLE `customers` ADD `discount_percent` int DEFAULT 0 NOT NULL;\n",
      "ALTER TABLE `reservations` ADD `production_start_date` timestamp NULL;\n",
      "ALTER TABLE `reservations` ADD `production_end_date` timestamp NULL;",
    ];
    const existingTables = new Set(["customers", "reservations"]);
    // Only customers.discount_percent exists; reservations.production_* are missing!
    const existingColumns = new Set(["customers.discount_percent"]);

    const decision = shouldPreSkipPendingMigration(
      multiStatementSql,
      existingTables,
      existingColumns,
    );

    assert.equal(decision.shouldSkip, false);
  });

  it("skips a migration only when ALL target columns in all statements already exist", () => {
    const multiStatementSql = [
      "ALTER TABLE `reservations` ADD `production_start_date` timestamp NULL;\n",
      "ALTER TABLE `reservations` ADD `production_end_date` timestamp NULL;",
    ];
    const existingTables = new Set(["reservations"]);
    const existingColumns = new Set([
      "reservations.production_start_date",
      "reservations.production_end_date",
    ]);

    const decision = shouldPreSkipPendingMigration(
      multiStatementSql,
      existingTables,
      existingColumns,
    );

    assert.equal(decision.shouldSkip, true);
  });

  it("does NOT skip a multi-table CREATE TABLE migration when one of the tables is missing", () => {
    const sql = [
      "CREATE TABLE `table_a` (`id` varchar(21) NOT NULL);",
      "CREATE TABLE `table_b` (`id` varchar(21) NOT NULL);",
    ];
    const existingTables = new Set(["table_a"]);
    const existingColumns = new Set(["table_a.id"]);

    const decision = shouldPreSkipPendingMigration(sql, existingTables, existingColumns);
    assert.equal(decision.shouldSkip, false);
  });

  it("does NOT pre-skip migrations containing non-ADD statements (e.g. MODIFY, UPDATE, ADD CONSTRAINT)", () => {
    const existingTables = new Set(["reservations"]);
    const existingColumns = new Set(["reservations.production_start_date"]);

    assert.equal(
      shouldPreSkipPendingMigration(
        [
          "ALTER TABLE `reservations` ADD `production_start_date` timestamp NULL;",
          "UPDATE `reservations` SET `production_start_date` = `start_date`;",
        ],
        existingTables,
        existingColumns,
      ).shouldSkip,
      false,
    );

    assert.equal(
      shouldPreSkipPendingMigration(
        ["ALTER TABLE `reservations` ADD CONSTRAINT `fk_test` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`);"],
        existingTables,
        existingColumns,
      ).shouldSkip,
      false,
    );
  });
});

describe("findMissingSchemaColumnHealStatements", () => {
  it("finds the exact ALTER TABLE ADD statements for missing schema columns even when earlier migrations were marked applied", () => {
    const allMigrations = readMigrationFiles({
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsTable: "__drizzle_migrations",
    });

    const expectedSchema = new Map<string, Set<string>>([
      ["customers", new Set(["id", "discount_percent"])],
      ["reservations", new Set(["id", "production_start_date", "production_end_date"])],
    ]);

    const existingTables = new Set(["customers", "reservations"]);
    // Simulate production state where customers.discount_percent exists,
    // but reservations.production_start_date and production_end_date are missing
    const existingColumns = new Set([
      "customers.id",
      "customers.discount_percent",
      "reservations.id",
    ]);

    const healStatements = findMissingSchemaColumnHealStatements(
      allMigrations,
      existingTables,
      existingColumns,
      expectedSchema,
    );

    assert.deepEqual(
      healStatements.map((item) => item.key),
      ["reservations.production_start_date", "reservations.production_end_date"],
    );
    assert.ok(
      healStatements[0]?.sql.includes("ALTER TABLE `reservations` ADD `production_start_date`"),
    );
    assert.ok(
      healStatements[1]?.sql.includes("ALTER TABLE `reservations` ADD `production_end_date`"),
    );
  });
});
