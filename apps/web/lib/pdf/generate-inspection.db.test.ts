import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import sharp from "sharp";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { useStoredImages } from "./stored-images.fixtures";

// The inspection report of a migrated database: its photos are read by their
// stored key, in their order, whatever format they were saved in, and a photo
// or a logo that cannot be read leaves the report whole. Storage is a map.

const { stored, reads } = useStoredImages();

const STORE = "store_inspection_pdf";
const PHOTOS = `${STORE}/inspections`;
const LOGO = `${STORE}/logo/logo.webp`;

/** The image objects PDFKit wrote, one per embedded image: their dictionaries are not compressed. */
const embeddedImages = (pdf: Buffer) =>
  Array.from(pdf.toString("latin1").matchAll(/\/Subtype\s*\/Image\b/g)).length;

/** A distinct opaque image per call, so no two embed as one. */
let shade = 0;
const image = (format: "jpeg" | "png" | "webp" | "gif") => {
  shade += 10;
  return sharp({
    create: { width: 40 + shade, height: 30, channels: 3, background: { r: shade, g: 90, b: 160 } },
  })
    .toFormat(format)
    .toBuffer();
};

describe("inspection report (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let report: typeof import("./generate-inspection");
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  before(async () => {
    // Stored images are served by the app under /files, as with the bundled storage.
    process.env.S3_PUBLIC_URL = "/files";
    database = await createTestDatabase("inspection_report");
    louezDb = await import("@louez/db");
    report = await import("./generate-inspection");

    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "user_inspection_pdf",
      name: "Brest Surf",
      slug: "brest-surf-pdf",
      logoUrl: `/files/${LOGO}`,
    });
    await louezDb.db.insert(louezDb.customers).values({
      id: "cus_inspection_pdf",
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

  beforeEach(() => {
    stored.clear();
    reads.length = 0;
  });

  /** A departure inspection with one item per entry, each with its photos as given. */
  async function inspection(items: Array<Array<{ key: string; displayOrder: number }>>) {
    const reservationId = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId: STORE,
      customerId: "cus_inspection_pdf",
      number: reservationId,
      status: "confirmed",
      startDate: new Date("2031-05-10T09:00:00.000Z"),
      endDate: new Date("2031-05-12T09:00:00.000Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    const inspectionId = nextId("ins");
    await louezDb.db
      .insert(louezDb.inspections)
      .values({ id: inspectionId, storeId: STORE, reservationId, type: "departure" });
    for (const photos of items) {
      const reservationItemId = nextId("itm");
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: reservationItemId,
        reservationId,
        productId: nextId("prd"),
        quantity: 1,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "10.00",
        productSnapshot: { name: "Surf", description: null, images: [] },
      });
      const inspectionItemId = nextId("iit");
      await louezDb.db.insert(louezDb.inspectionItems).values({
        id: inspectionItemId,
        inspectionId,
        reservationItemId,
        productSnapshot: { name: "Surf" },
        overallCondition: "good",
      });
      for (const photo of photos) {
        await louezDb.db.insert(louezDb.inspectionPhotos).values({
          id: nextId("pho"),
          inspectionItemId,
          photoKey: photo.key,
          // What the report reads is the key: the URL stays as written.
          photoUrl: `/files/${photo.key}`,
          displayOrder: photo.displayOrder,
        });
      }
    }
    return inspectionId;
  }

  test("a report embeds its photos in their order, whatever their format, and its logo", async () => {
    stored.set(`${PHOTOS}/a.webp`, await image("webp"));
    stored.set(`${PHOTOS}/b.jpg`, await image("jpeg"));
    stored.set(`${PHOTOS}/c.png`, await image("png"));
    stored.set(`${PHOTOS}/e.png`, await image("png"));
    stored.set("store_other/inspections/x.png", await image("png"));
    stored.set(LOGO, await image("webp"));

    const inspectionId = await inspection([
      // Written out of order: the report follows display_order.
      [
        { key: `${PHOTOS}/missing.webp`, displayOrder: 3 },
        { key: `${PHOTOS}/a.webp`, displayOrder: 0 },
        { key: `${PHOTOS}/e.png`, displayOrder: 4 },
        { key: `${PHOTOS}/b.jpg`, displayOrder: 1 },
        { key: `${PHOTOS}/c.png`, displayOrder: 2 },
      ],
      // Another store's file, never read: the card shows it as unavailable.
      [{ key: "store_other/inspections/x.png", displayOrder: 0 }],
    ]);

    const { buffer } = await report.generateInspectionReport({ inspectionId, locale: "fr" });
    const pdf = Buffer.from(buffer);

    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    // The four shown photos of the first card are read, the fifth only counted;
    // the missing one leaves its place to "Photo unavailable".
    assert.deepEqual(
      reads.map((read) => read.key),
      [`${PHOTOS}/a.webp`, `${PHOTOS}/b.jpg`, `${PHOTOS}/c.png`, `${PHOTOS}/missing.webp`, LOGO],
    );
    // The WebP photo as a JPEG, the JPEG, the PNG and the WebP logo as a PNG.
    assert.equal(embeddedImages(pdf), 4);
  });

  test("a report whose photos and logo cannot be read still renders", async () => {
    stored.set(`${PHOTOS}/f.webp`, new Error("socket hang up"));
    stored.set(`${PHOTOS}/g.jpg`, Buffer.from("not an image"));
    stored.set(LOGO, new Error("socket hang up"));

    const inspectionId = await inspection([
      [
        { key: `${PHOTOS}/f.webp`, displayOrder: 0 },
        { key: `${PHOTOS}/g.jpg`, displayOrder: 1 },
      ],
    ]);

    const { buffer } = await report.generateInspectionReport({ inspectionId, locale: "en" });
    const pdf = Buffer.from(buffer);

    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(embeddedImages(pdf), 0);
  });
});
