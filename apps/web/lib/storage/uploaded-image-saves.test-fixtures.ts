import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { and, asc, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

const STORE = "store_uploaded_saves1";
const OTHER_STORE = "store_uploaded_other1";
const USER = "user_uploaded_saves";
const CUSTOMER = "cus_uploaded_saves";

/** A 21-character id, the length the inspection's schema takes. */
let counter = 0;
const nextId = (prefix: string) =>
  `${prefix}${String(++counter).padStart(21 - prefix.length, "0")}`;

/**
 * The saves that store an uploaded image, an inspection's photos and an
 * account's avatar, on a migrated database with storage served from
 * `publicUrl` (S3_PUBLIC_URL). Each derives the stored URL from the upload's
 * key, `urlOf(key)` in that mode, and refuses a key that would leave the
 * owner's folder. Call it before anything loads the app's env.
 */
export function describeUploadedImageSaves(publicUrl: string, urlOf: (key: string) => string) {
  process.env.S3_PUBLIC_URL = publicUrl;
  // The bucket is never reached: a URL is derived from a key, not fetched.
  process.env.S3_ENDPOINT = "http://127.0.0.1:9";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_BUCKET = "louez-test";
  process.env.S3_ACCESS_KEY_ID = "test";
  process.env.S3_SECRET_ACCESS_KEY = "test";

  // The session, the page cache and the analytics are stubbed; the database
  // and the storage's URLs are real.
  const stubs = {
    "@/lib/store-context": { getCurrentStore: async () => ({ id: STORE, userId: USER }) },
    "@/lib/auth": { auth: async () => ({ user: { id: USER } }) },
    "next/cache": { revalidatePath: () => undefined },
    "@/lib/product-analytics/analytics": { captureReservationActionSucceeded: async () => {} },
    "@/lib/test-reservations/lifecycle": { captureTestInspection: async () => {} },
  };
  Reflect.set(globalThis, "__louezUploadedImageSaveStubs", stubs);
  const directory = mkdtempSync(join(tmpdir(), "louez-uploaded-image-saves-"));
  after(() => rmSync(directory, { recursive: true }));
  const files = new Map(
    Object.keys(stubs).map((specifier, index) => {
      const path = join(directory, `stub-${index}.cjs`);
      writeFileSync(
        path,
        `module.exports = globalThis.__louezUploadedImageSaveStubs[${JSON.stringify(specifier)}];`,
      );
      return [specifier, pathToFileURL(path).href];
    }),
  );
  const filesSdk = new URL("../../node_modules/files-sdk/dist/", import.meta.url);
  Reflect.get(
    nodeModule,
    "registerHooks",
  )({
    resolve(
      specifier: string,
      context: unknown,
      next: (specifier: string, context: unknown) => unknown,
    ) {
      if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
      // files-sdk exports ESM only, through an "import" condition the test's require misses.
      if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
        const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
        return { url: new URL(entry, filesSdk).href, shortCircuit: true };
      }
      const url = files.get(specifier);
      return url ? { url, shortCircuit: true } : next(specifier, context);
    },
  });

  describe(
    `uploaded image saves with S3_PUBLIC_URL=${publicUrl} (database)`,
    { skip: skipWithoutTestDatabase() },
    () => {
      let database: TestDatabase;
      let louezDb: typeof import("@louez/db");
      let isOwnedImageUrl: typeof import("@louez/validations").isOwnedImageUrl;
      let inspections: typeof import("@/app/(dashboard)/dashboard/reservations/[id]/inspection/actions");
      let account: typeof import("@/app/(dashboard)/dashboard/account/actions");

      before(async () => {
        database = await createTestDatabase("uploaded_image_saves");
        louezDb = await import("@louez/db");
        ({ isOwnedImageUrl } = await import("@louez/validations"));
        inspections =
          await import("@/app/(dashboard)/dashboard/reservations/[id]/inspection/actions");
        account = await import("@/app/(dashboard)/dashboard/account/actions");

        await louezDb.db
          .insert(louezDb.users)
          .values({ id: USER, email: "owner@example.com", name: "Owner" });
        await louezDb.db.insert(louezDb.stores).values([
          { id: STORE, userId: USER, name: "Brest Surf", slug: "brest-surf-saves" },
          { id: OTHER_STORE, userId: "user_other", name: "Other", slug: "other-saves" },
        ]);
        await louezDb.db.insert(louezDb.customers).values({
          id: CUSTOMER,
          storeId: STORE,
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
        });
      });

      after(async () => {
        await louezDb?.db.$client.end();
        await database?.drop();
      });

      /** A confirmed reservation of the store, with one line to inspect. */
      async function reservationLine() {
        const reservationId = nextId("res");
        const productId = nextId("prd");
        const reservationItemId = nextId("itm");
        await louezDb.db.insert(louezDb.products).values({
          id: productId,
          storeId: STORE,
          name: "Surf",
          price: "10.00",
          pricingMode: "day",
        });
        await louezDb.db.insert(louezDb.reservations).values({
          id: reservationId,
          storeId: STORE,
          customerId: CUSTOMER,
          number: reservationId,
          status: "confirmed",
          startDate: new Date("2031-05-10T09:00:00.000Z"),
          endDate: new Date("2031-05-12T09:00:00.000Z"),
          subtotalAmount: "10.00",
          depositAmount: "0.00",
          totalAmount: "10.00",
        });
        await louezDb.db.insert(louezDb.reservationItems).values({
          id: reservationItemId,
          reservationId,
          productId,
          quantity: 1,
          unitPrice: "10.00",
          depositPerUnit: "0.00",
          totalPrice: "10.00",
          productSnapshot: { name: "Surf", description: null, images: [] },
        });
        return { reservationId, reservationItemId };
      }

      async function saveInspection(photos: Array<{ key: string; caption?: string }>) {
        const { reservationId, reservationItemId } = await reservationLine();
        const result = await inspections.createInspection({
          reservationId,
          type: "departure",
          items: [{ reservationItemId, overallCondition: "good", fieldValues: [], photos }],
        });
        return { reservationId, result };
      }

      async function savedPhotos(inspectionId: string) {
        return louezDb.db
          .select({
            photoKey: louezDb.inspectionPhotos.photoKey,
            photoUrl: louezDb.inspectionPhotos.photoUrl,
            caption: louezDb.inspectionPhotos.caption,
          })
          .from(louezDb.inspectionPhotos)
          .innerJoin(
            louezDb.inspectionItems,
            eq(louezDb.inspectionItems.id, louezDb.inspectionPhotos.inspectionItemId),
          )
          .where(eq(louezDb.inspectionItems.inspectionId, inspectionId))
          .orderBy(asc(louezDb.inspectionPhotos.displayOrder));
      }

      test("an inspection saves each photo with the URL of its key", async () => {
        const { result } = await saveInspection([
          { key: "a1.webp" },
          { key: "b2.jpg", caption: "Nose" },
        ]);
        assert.equal(result.error, undefined);
        assert.ok(result.inspectionId);

        const photos = await savedPhotos(result.inspectionId);
        assert.deepEqual(photos, [
          {
            photoKey: `${STORE}/inspections/a1.webp`,
            photoUrl: urlOf(`${STORE}/inspections/a1.webp`),
            caption: null,
          },
          {
            photoKey: `${STORE}/inspections/b2.jpg`,
            photoUrl: urlOf(`${STORE}/inspections/b2.jpg`),
            caption: "Nose",
          },
        ]);
        // The URL passes the ownership rule the rest of the app applies in this mode.
        for (const photo of photos) {
          assert.ok(isOwnedImageUrl(photo.photoUrl, `${STORE}/inspections`), photo.photoUrl);
        }
      });

      test("a URL sent with a photo is ignored: the stored one is its key's", async () => {
        // A wizard opened before the URL left the payload still sends it.
        const photo = {
          key: "c3.webp",
          url: `https://evil.example/${OTHER_STORE}/inspections/x.webp`,
        };
        const { result } = await saveInspection([photo]);
        assert.ok(result.inspectionId);

        const [saved] = await savedPhotos(result.inspectionId);
        assert.equal(saved.photoUrl, urlOf(`${STORE}/inspections/c3.webp`));
      });

      test("a key of another store, or with a path, is refused and nothing is written", async () => {
        for (const key of [
          `${OTHER_STORE}/inspections/x.webp`,
          `../${OTHER_STORE}/inspections/x.webp`,
          `..%2F${OTHER_STORE}%2Fx.webp`,
          "a.webp/../x.webp",
          ".webp",
          "x.svg",
        ]) {
          const { reservationId, result } = await saveInspection([{ key }]);
          assert.equal(result.error, "errors.invalidData", key);
          const written = await louezDb.db
            .select({ id: louezDb.inspections.id })
            .from(louezDb.inspections)
            .where(
              and(
                eq(louezDb.inspections.reservationId, reservationId),
                eq(louezDb.inspections.storeId, STORE),
              ),
            );
          assert.deepEqual(written, [], key);
        }
      });

      const avatar = async () => {
        const [user] = await louezDb.db
          .select({ image: louezDb.users.image })
          .from(louezDb.users)
          .where(eq(louezDb.users.id, USER));
        return user.image;
      };

      test("an avatar saves the URL of its key; none keeps it, null removes it", async () => {
        assert.equal(
          (await account.updateAccountInfo({ name: "Ada", imageKey: "me.webp" })).error,
          undefined,
        );
        assert.equal(await avatar(), urlOf(`users/${USER}/me.webp`));

        await account.updateAccountInfo({ name: "Ada" });
        assert.equal(await avatar(), urlOf(`users/${USER}/me.webp`));

        await account.updateAccountInfo({ name: "Ada", imageKey: null });
        assert.equal(await avatar(), null);
      });

      test("an avatar key with a path is refused", async () => {
        await account.updateAccountInfo({ name: "Ada", imageKey: "mine.png" });
        for (const imageKey of ["users/user_other/me.webp", "../user_other/me.webp"]) {
          const result = await account.updateAccountInfo({ name: "Ada", imageKey });
          assert.equal(result.error, "errors.invalidData", imageKey);
        }
        assert.equal(await avatar(), urlOf(`users/${USER}/mine.png`));
      });
    },
  );
}
