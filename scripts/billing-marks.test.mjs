/**
 * A write that can change a billing snapshot marks its aggregate dirty in the
 * same transaction (DL-13 in docs/code-review/04-data-layer.md; louez-billing
 * docs/api README §5.2), with markBillingDirty
 * or one of its wrappers in packages/db/src/billing-queue.ts. A write without
 * a mark is sent only once the nightly sweep catches it.
 *
 * The test parses every source file under apps/ and packages/, outside
 * packages/db/src, where the helpers live and mark for their callers. It lists
 * the writes to the tables the snapshots read, and a file with such a write
 * must reference a mark helper. It reads syntax only, as
 * reservation-writes.test.mjs does, and checks the file, not the transaction:
 * a mark in another function of the same file passes. Review checks that the
 * mark sits in the write's transaction.
 *
 * Not covered, because no syntax rule can see the table or the SQL:
 * - a write on a table the file gets as a parameter;
 * - `sql.raw` of a variable, and SQL built by string concatenation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ROOT,
  calledMethod,
  isCall,
  listSourceFiles,
  parseSource,
  propertyKey,
  readBindings,
  readKnownTables,
  receiverCall,
  unwrap,
  walk,
} from "./source-scan.mjs";

const MARK_HELPERS = new Set([
  "markBillingDirty",
  "markReservation",
  "markReservationIds",
  "markStoreReservations",
  "markStore",
  "markLegacyStore",
  "markSubscriptionRow",
  "markLegacyMonth",
  "billingMarkStatement",
]);

// Any insert or delete of these can change a snapshot, and any update unless
// UPDATED_COLUMNS lists the table.
const WRITTEN_TABLES = new Set([
  "payments",
  "paymentDisputes",
  "platformFees",
  "payAsYouGoInvoices",
  "subscriptions",
  "storeLegalProfiles",
  "storeMembers",
  "storeMarketplaceChannels",
  "referralRewards",
  "reservationItems",
]);
/**
 * Only the updates of these that may write a column the builders read
 * (apps/web/lib/billing-sync/snapshots). Inserts and deletes of stores and
 * reservations are not checked: reservations are inserted by insertReservation,
 * which marks (reservation-writes.test.mjs), and the nightly sweep marks every
 * store. Keep these lists in step with the builders.
 */
const UPDATED_COLUMNS = new Map([
  [
    "stores",
    new Set([
      "slug",
      "settings",
      "onboardingCompleted",
      "stripeAccountId",
      "stripeChargesEnabled",
      "stripeOnboardingComplete",
      "referredByUserId",
      "referredByStoreId",
      "signupOrigin",
      "trialDays",
      "discountPercent",
      "discountDurationMonths",
      "stripeCouponId",
      "createdAt",
    ]),
  ],
  [
    "reservations",
    new Set([
      "number",
      "status",
      "source",
      "startDate",
      "endDate",
      "billableAt",
      "withdrawnAt",
      "currency",
      "totalAmount",
      "subtotalAmount",
      "depositAmount",
      "tulipInsuranceAmount",
      "storeId",
      "createdAt",
    ]),
  ],
  ["reservationItems", new Set(["reservationId", "productId", "taxRate", "totalPrice"])],
]);
/**
 * The keys of `stores.settings` the builders read: country, timezone and currency
 * for the store, the tax mode and default rate for reservation totals. A
 * `settings: { ...stored, delivery }` literal that sets none of them keeps them.
 */
const SETTINGS_KEYS = new Set(["country", "timezone", "currency", "tax"]);
const DRIZZLE_WRITES = new Set(["insert", "update", "delete"]);

/** The tree outside the rule: the helpers and their scripts. */
const EXCLUDED_PREFIX = "packages/db/src/";

/**
 * Each entry allows, in one file, the given number of unmarked writes per
 * table. The test fails when an entry matches any other number, so the list
 * cannot go stale.
 */
const ALLOWLIST = [
  {
    file: "apps/web/app/(dashboard)/dashboard/settings/integrations/actions.ts",
    writes: { stores: 1 },
    reason: "the adapters return the stored settings with only integrationData changed",
  },
  {
    file: "apps/web/app/(dashboard)/dashboard/team/actions.ts",
    writes: { storeMembers: 2 },
    reason: "adds members with role member and removes non-owners only; the snapshot lists owners",
  },
  {
    file: "apps/web/lib/ai/tools.ts",
    writes: { stores: 1 },
    reason: "update_store_info: name, email, phone, address and description (zod schema)",
  },
  {
    file: "packages/mcp/src/tools/settings.ts",
    writes: { stores: 2 },
    reason: "update_store_info and update_store_legal: contact and legal text columns only",
  },
  {
    file: "packages/api/src/services/store-settings.ts",
    writes: { stores: 3 },
    reason:
      "legal texts, appearance and the online store editor: other columns, and settings " +
      "re-read with country, timezone, currency and tax kept",
  },
  {
    file: "apps/web/lib/reservations/create-reservation.ts",
    writes: { payments: 1, reservationItems: 1 },
    reason:
      "in the transaction of changeReservationStatus (the superseded pending payments) and " +
      "insertReservation (the new items), which mark those reservations",
  },
  {
    file: "apps/web/scripts/seed/index.ts",
    writes: { subscriptions: 1, storeMembers: 1, reservationItems: 1, payments: 1 },
    reason: "development seed; `pnpm billing:mark --all` queues what it writes",
  },
  {
    file: "apps/web/scripts/seed/demo/index.ts",
    writes: {
      payments: 1,
      reservationItems: 1,
      storeMembers: 2,
      platformFees: 1,
      payAsYouGoInvoices: 1,
      subscriptions: 2,
    },
    reason: "demo seed, which refuses production; `pnpm billing:mark --all` queues what it writes",
  },
  {
    file: "apps/web/scripts/storefront-qa/seed.ts",
    writes: { storeMembers: 1, subscriptions: 1, reservationItems: 2, payments: 4 },
    reason: "QA fixtures on the isolated QA database, which has no billing service",
  },
];

// A table name as a whole word, bare, qualified or in backticks.
const nameSql = (name) => `(?<![\\w\`])(?:\`?\\w+\`?\\.)?\`?${name}\`?(?![\\w\`])`;
const INSERT_SQL =
  "\\b(?:INSERT|REPLACE)(?:\\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE))*\\s+";
// A column assignment, so "update stores, then set a reminder" is not SQL.
const ASSIGNMENT_SQL = "\\bSET\\s+(?:[`\\w.]+|\\?)\\s*=";
const NOT_SET = "(?:(?!\\bSET\\b)[^;])*";
const NOT_FROM = "(?:(?!\\bFROM\\b)[^;])*";

/** The raw SQL patterns of a write to one table. */
function rawWritePatterns(sqlName, kinds) {
  const name = nameSql(sqlName);
  const patterns = [
    // Single-table, multi-table and JOIN updates.
    new RegExp(`\\bUPDATE\\b${NOT_SET}?${name}${NOT_SET}${ASSIGNMENT_SQL}`, "i"),
  ];
  if (kinds === "all") {
    patterns.push(
      new RegExp(`${INSERT_SQL}INTO\\s+${name}`, "i"),
      // MySQL accepts INSERT without INTO.
      new RegExp(
        `${INSERT_SQL}${name}\\s*(?:\\(|\\bVALUES?\\b|\\bSELECT\\b|${ASSIGNMENT_SQL})`,
        "i",
      ),
      new RegExp(`\\bDELETE\\b${NOT_FROM}\\bFROM\\s+${name}`, "i"),
    );
  }
  return patterns;
}

function watchedTables(tables) {
  const watched = new Map();
  for (const name of UPDATED_COLUMNS.keys()) watched.set(name, "update");
  for (const name of WRITTEN_TABLES) watched.set(name, "all");
  for (const name of watched.keys()) {
    if (!tables.has(name)) throw new Error(`${name} is not a schema table`);
  }
  return watched;
}

/** The watched writes of one file, and whether it references a mark helper. */
function findWrites(code, file, tables) {
  const ast = parseSource(code, file);
  const { tableOf } = readBindings(ast, tables);
  const watched = watchedTables(tables);
  const rawPatterns = [...watched].map(([name, kinds]) => ({
    name,
    patterns: rawWritePatterns(tables.get(name), kinds),
  }));
  const writes = [];
  let marks = false;
  // `.update(t)` call → the `.set(…)` call chained on it.
  const setCalls = new Map();
  const text = (node) => (node ? code.slice(node.start, node.end).replace(/\s+/g, " ") : "");
  const report = (node, table, expression) => {
    writes.push({ file, line: node.loc.start.line, table, expression });
  };

  // The keys of `.set(…)` that may write a column the builders read; null when none.
  const snapshotKeys = (update, table) => {
    const set = setCalls.get(update);
    if (!set) return "(split chain)";
    const values = unwrap(set.arguments[0]);
    if (values?.type !== "ObjectExpression") return text(values ?? set);
    const columns = UPDATED_COLUMNS.get(table);
    const keys = values.properties.flatMap((property) => {
      if (property.type === "SpreadElement") return [`...${text(property.argument)}`];
      const key = propertyKey(property);
      if (key === null) return [text(property.key)];
      if (table === "stores" && key === "settings") return settingsKeys(property.value);
      return columns.has(key) ? [key] : [];
    });
    return keys.length > 0 ? keys.join(", ") : null;
  };
  // The keys a `settings` value may write among SETTINGS_KEYS.
  const settingsKeys = (value) => {
    const settings = unwrap(value);
    if (settings?.type !== "ObjectExpression") return ["settings"];
    return settings.properties.flatMap((property) => {
      // A spread is the stored settings, read just before the write.
      if (property.type === "SpreadElement") return [];
      const key = propertyKey(property);
      if (key === null) return [`settings[${text(property.key)}]`];
      return SETTINGS_KEYS.has(key) ? [`settings.${key}`] : [];
    });
  };

  const checkRawSql = (node, sqlText) => {
    for (const { name, patterns } of rawPatterns) {
      if (patterns.some((pattern) => pattern.test(sqlText))) {
        report(node, name, text(node).slice(0, 80));
      }
    }
  };

  walk(ast.program, (node) => {
    if (node.type === "Identifier" && MARK_HELPERS.has(node.name)) marks = true;

    if (node.type === "StringLiteral") checkRawSql(node, node.value);
    if (node.type === "TemplateLiteral") {
      // An interpolated schema table reads as its SQL name, any other value as `?`.
      const sqlText = node.quasis
        .map((quasi, index) => {
          const value = quasi.value.cooked ?? quasi.value.raw;
          const expression = node.expressions[index];
          if (!expression) return value;
          const table = tableOf(expression);
          return `${value} ${table ? tables.get(table) : "?"} `;
        })
        .join("");
      checkRawSql(node, sqlText);
    }

    if (!isCall(node)) return;
    const method = calledMethod(node);
    if (method === "set") {
      const receiver = receiverCall(node);
      if (receiver && calledMethod(receiver) === "update") setCalls.set(receiver, node);
      return;
    }
    if (!DRIZZLE_WRITES.has(method)) return;
    const table = tableOf(node.arguments[0]);
    const kinds = table ? watched.get(table) : undefined;
    if (!kinds) return;
    const expression = `${method}(${text(node.arguments[0])})`;
    if (method === "update" && UPDATED_COLUMNS.has(table)) {
      const keys = snapshotKeys(node, table);
      if (keys !== null) report(node, table, `${expression}: ${keys}`);
    } else if (kinds === "all") {
      report(node, table, expression);
    }
  });
  return { writes, marks };
}

/** The writes of a file that references no mark helper. */
function findViolations(code, file, tables) {
  const { writes, marks } = findWrites(code, file, tables);
  return marks ? [] : writes;
}

/** Splits violations into allowed and not, and lists entries that matched the wrong count. */
function applyAllowlist(violations, allowlist) {
  const matched = new Map(allowlist.map((entry) => [entry, {}]));
  const remaining = [];
  for (const violation of violations) {
    const entry = allowlist.find(
      (candidate) => candidate.file === violation.file && violation.table in candidate.writes,
    );
    if (!entry) {
      remaining.push(violation);
      continue;
    }
    const counts = matched.get(entry);
    counts[violation.table] = (counts[violation.table] ?? 0) + 1;
  }
  const stale = allowlist
    .filter((entry) =>
      Object.entries(entry.writes).some(([table, count]) => matched.get(entry)[table] !== count),
    )
    .map((entry) => ({ ...entry, matched: matched.get(entry) }));
  return { remaining, stale };
}

const tables = readKnownTables();

// The snippets below run after these imports, as a file that writes to the database does.
const SNIPPET_IMPORTS = `import { payments, platformFees, products, reservations, stores } from "@louez/db";
import * as schema from "@louez/db/schema";
`;
const tablesIn = (code) =>
  findViolations(SNIPPET_IMPORTS + code, "snippet.ts", tables).map(({ table }) => table);

test("the watched tables are schema tables", () => {
  assert.equal(
    watchedTables(tables).size,
    new Set([...WRITTEN_TABLES, ...UPDATED_COLUMNS.keys()]).size,
  );
  assert.equal(tables.get("platformFees"), "platform_fee");
});

test("each unmarked write gives exactly one violation", () => {
  const forbidden = {
    insert: ["payments", `await tx.insert(payments).values(row);`],
    update: ["payments", `await tx.update(payments).set({ amount }).where(scope);`],
    delete: ["payments", `await tx.delete(payments).where(eq(payments.id, id));`],
    namespaced: ["paymentDisputes", `await db.insert(schema.paymentDisputes).values(row);`],
    aliased: [
      "subscriptions",
      `import { subscriptions as subs } from "@louez/db";
       await db.update(subs).set({ status: "active" });`,
    ],
    destructured: [
      "storeMembers",
      `const { storeMembers: members } = schema; await tx.delete(members).where(scope);`,
    ],
    dynamicImport: [
      "storeLegalProfiles",
      `const { storeLegalProfiles: profiles } = await import("@louez/db");
       await db.insert(profiles).values(row);`,
    ],
    storeUpdate: ["stores", `await db.update(stores).set({ slug }).where(eq(stores.id, id));`],
    storeSettings: ["stores", `await db.update(stores).set({ settings: next, updatedAt });`],
    storeCurrency: [
      "stores",
      `await db.update(stores).set({ settings: { ...settings, currency: "USD" } });`,
    ],
    storeTax: ["stores", `await db.update(stores).set({ settings: { ...settings, tax } });`],
    storeSpread: ["stores", `await db.update(stores).set({ ...changes });`],
    storeVariable: ["stores", `await db.update(stores).set(changes);`],
    storeComputedKey: ["stores", `await db.update(stores).set({ [column]: value });`],
    storeSplitChain: ["stores", `const q = db.update(stores); await q.set({ slug });`],
    reservationUpdate: [
      "reservations",
      `await tx.update(reservations).set({ endDate }).where(scope);`,
    ],
    quotedKey: ["reservations", `await tx.update(reservations).set({ "totalAmount": total });`],
    itemDelete: ["reservationItems", `await tx.delete(schema.reservationItems).where(scope);`],
    itemPrice: [
      "reservationItems",
      `await tx.update(schema.reservationItems).set({ totalPrice });`,
    ],
    rawInsert: ["platformFees", `const s = "INSERT INTO platform_fee (id) VALUES (?)";`],
    rawUpdate: ["subscriptions", "await conn.query('UPDATE `subscriptions` SET plan_slug = ?');"],
    rawDelete: ["payments", `const s = "DELETE FROM payments WHERE id = ?";`],
    rawJoinDelete: [
      "payments",
      `const s = "DELETE p FROM payments p JOIN reservations r ON r.id = p.reservation_id";`,
    ],
    rawStoreUpdate: ["stores", "await conn.query(`UPDATE stores SET slug = ? WHERE id = ?`);"],
    interpolatedTable: [
      "platformFees",
      "await db.execute(sql`UPDATE ${platformFees} SET ${platformFees.status} = 'voided'`);",
    ],
  };
  for (const [name, [table, code]] of Object.entries(forbidden)) {
    assert.deepEqual(tablesIn(code), [table], name);
  }
});

test("each write that needs no mark gives no violation", () => {
  const allowed = {
    read: `await db.select().from(payments).where(eq(payments.id, id));`,
    otherTable: `await db.update(products).set({ status: "archived" });`,
    storeInsert: `await tx.insert(stores).values(row);`,
    storeOtherColumns: `await db.update(stores).set({ name, logoUrl, updatedAt: new Date() });`,
    storeOtherSettings: `await db
      .update(stores)
      .set({ settings: { ...currentSettings, delivery: deliverySettings } });`,
    reservationOtherColumns: `await tx
      .update(reservations)
      .set({ tulipContractId, internalNotes: notes, updatedAt: new Date() })
      .where(scope);`,
    reservationDelete: `await tx.delete(reservations).where(scope);`,
    itemCombination: `await tx.update(schema.reservationItems).set({ combinationKey });`,
    otherTableSql: `const s = "UPDATE payment_requests SET status = 'completed'";`,
    readInSubquery: `const s = "UPDATE products SET x = (SELECT COUNT(*) FROM payments)";`,
    deleteOtherTable: `const s = "DELETE FROM reservation_activity WHERE id IN (SELECT id FROM payments)";`,
    prose: `const prompt = "Update stores, then set a reminder";`,
    hash: `createHash("sha256").update(content).digest("hex");`,
    mapDelete: `cache.delete(key);`,
  };
  for (const [name, code] of Object.entries(allowed)) {
    assert.deepEqual(tablesIn(code), [], name);
  }
});

test("a mark helper anywhere in the file covers its writes", () => {
  const writes = `await tx.insert(payments).values(row);
    await db.update(stores).set({ slug });`;
  assert.deepEqual(tablesIn(writes), ["payments", "stores"]);
  for (const mark of [
    `import { markReservation } from "@louez/db";`,
    `await deps.markStore(tx, store);`,
    `const statement = billingMarkStatement(marks);`,
  ]) {
    assert.deepEqual(tablesIn(`${mark}\n${writes}`), [], mark);
  }
});

test("a file that does not parse is named in the error", () => {
  assert.throws(
    () => findViolations("@decorator class A {}", "broken.ts", tables),
    /^Error: broken\.ts: /,
  );
});

test("an allowlist entry that matches the wrong count is reported", () => {
  const entry = { file: "snippet.ts", writes: { payments: 1 } };
  const one = findViolations(`${SNIPPET_IMPORTS}db.delete(payments);`, "snippet.ts", tables);
  assert.deepEqual(applyAllowlist(one, [entry]).stale, []);
  assert.deepEqual(applyAllowlist([...one, ...one], [entry]).stale[0].matched, { payments: 2 });
  assert.deepEqual(applyAllowlist([], [entry]).stale[0].matched, {});
  const other = findViolations(`${SNIPPET_IMPORTS}db.delete(platformFees);`, "snippet.ts", tables);
  assert.equal(applyAllowlist(other, [entry]).remaining.length, 1);
});

test("writes that change a billing snapshot mark it", () => {
  const files = listSourceFiles().filter((file) => !file.startsWith(EXCLUDED_PREFIX));
  assert.ok(files.length > 1000, `only ${files.length} source files found`);

  const violations = files.flatMap((file) =>
    findViolations(readFileSync(path.join(ROOT, file), "utf8"), file, tables),
  );
  const { remaining, stale } = applyAllowlist(violations, ALLOWLIST);

  const help =
    "See [DL-13] in docs/code-review/04-data-layer.md. " +
    "A write to a table a billing snapshot reads marks the aggregate in the same " +
    "transaction: markReservation, markReservationIds, markStore, markLegacyStore, " +
    "markSubscriptionRow, markLegacyMonth or markBillingDirty from @louez/db, or " +
    "billingMarkStatement on a raw connection. Allowlist a write only when it changes " +
    "no snapshot field, and fix or remove an entry that matches the wrong count.";
  assert.deepEqual(
    {
      violations: remaining.map((v) => `${v.file}:${v.line} ${v.table}: ${v.expression}`),
      allowlistEntriesWithWrongCount: stale.map(
        (e) => `${e.file}: ${JSON.stringify(e.matched)} of ${JSON.stringify(e.writes)}`,
      ),
    },
    { violations: [], allowlistEntriesWithWrongCount: [] },
    help,
  );
});
