import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import { useStoredImages } from "./stored-images.fixtures";

// The images of a PDF, read from storage by key and made into what the
// renderer embeds. Storage is a map of keys to bytes; sharp is real.

const { stored, reads, warnings } = useStoredImages();

let pdfImages: typeof import("./image-utils");
let MAX_IMAGE_SIZE: number;

before(async () => {
  // Stored images are served by the app under /files, as with the bundled storage.
  process.env.S3_PUBLIC_URL = "/files";
  pdfImages = await import("./image-utils");
  ({ MAX_IMAGE_SIZE } = await import("@louez/validations"));
});

beforeEach(() => {
  stored.clear();
  reads.length = 0;
  warnings.length = 0;
});

const PHOTOS = "storeA/inspections";

const image = (format: "jpeg" | "png" | "webp" | "gif" | "avif", alpha = false) =>
  sharp({
    create: {
      width: 64,
      height: 48,
      channels: alpha ? 4 : 3,
      background: { r: 20, g: 120, b: 200, alpha: alpha ? 0.5 : 1 },
    },
  })
    .toFormat(format)
    .toBuffer();

const decode = (dataUrl: string | null) => {
  const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl ?? "");
  assert.ok(match, `not an embeddable data URL: ${dataUrl?.slice(0, 40)}`);
  return { format: match[1], bytes: Buffer.from(match[2], "base64") };
};

const pixel = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
};

test("a WebP or GIF photo becomes a JPEG the PDF embeds", async () => {
  for (const format of ["webp", "gif"] as const) {
    stored.set(`${PHOTOS}/a.${format}`, await image(format));
    const result = decode(
      await pdfImages.readStoredImageForPdf(`${PHOTOS}/a.${format}`, PHOTOS, "photo"),
    );
    assert.equal(result.format, "jpeg", format);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, "jpeg", format);
    assert.equal(metadata.width, 64, format);
  }
});

test("an AVIF photo, stored before uploads refused the format, becomes a JPEG", async () => {
  const bytes = await image("avif");
  // sharp reads AVIF as a HEIF image compressed with AV1.
  assert.equal((await sharp(bytes).metadata()).compression, "av1");
  stored.set(`${PHOTOS}/a.avif`, bytes);
  const result = decode(await pdfImages.readStoredImageForPdf(`${PHOTOS}/a.avif`, PHOTOS, "photo"));
  assert.equal(result.format, "jpeg");
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 64);
});

test("a JPEG or PNG photo is embedded as stored", async () => {
  for (const format of ["jpeg", "png"] as const) {
    const bytes = await image(format);
    stored.set(`${PHOTOS}/a.${format}`, bytes);
    const result = decode(
      await pdfImages.readStoredImageForPdf(`${PHOTOS}/a.${format}`, PHOTOS, "photo"),
    );
    assert.equal(result.format, format);
    assert.deepEqual(result.bytes, bytes);
  }
});

test("the file is read by its key, at most one byte past the upload cap", async () => {
  stored.set(`${PHOTOS}/a.webp`, await image("webp"));
  await pdfImages.readStoredImageForPdf(`${PHOTOS}/a.webp`, PHOTOS, "photo");
  assert.deepEqual(reads, [{ key: `${PHOTOS}/a.webp`, range: { start: 0, end: MAX_IMAGE_SIZE } }]);
});

test("a missing, unreadable, empty, oversized or non-image file leaves the photo out", async () => {
  stored.set(`${PHOTOS}/broken.webp`, new Error("socket hang up"));
  stored.set(`${PHOTOS}/empty.webp`, Buffer.alloc(0));
  stored.set(
    `${PHOTOS}/huge.jpg`,
    Buffer.concat([await image("jpeg"), Buffer.alloc(MAX_IMAGE_SIZE)]),
  );
  stored.set(`${PHOTOS}/text.png`, Buffer.from("not an image at all"));

  for (const name of ["missing.webp", "broken.webp", "empty.webp", "huge.jpg", "text.png"]) {
    assert.equal(
      await pdfImages.readStoredImageForPdf(`${PHOTOS}/${name}`, PHOTOS, "photo"),
      null,
      name,
    );
  }
  assert.equal(warnings.length, 5);
});

test("a key outside the folder is refused without being read", async () => {
  for (const key of [
    "storeB/inspections/a.webp",
    "storeA/inspectionsX/a.webp",
    "storeA/inspections/../../storeB/inspections/a.webp",
    "storeA/inspections/%2e%2e/storeB/a.webp",
    "storeA/inspections\\..\\storeB\\a.webp",
    "storeA/inspections/a.webp?v=1",
    "/storeA/inspections/a.webp",
    "storeA/inspections/a.txt",
  ]) {
    stored.set(key, await image("webp"));
    assert.equal(await pdfImages.readStoredImageForPdf(key, PHOTOS, "photo"), null, key);
  }
  assert.deepEqual(reads, []);
});

test("a key in a subfolder of the store's folder is read", async () => {
  // No writer ever used one (the photos keys are `<store>/inspections/<file>`),
  // but a photo of the store's own folder is read whatever its depth.
  stored.set(`${PHOTOS}/ins_1/photo_1.webp`, await image("webp"));
  const result = decode(
    await pdfImages.readStoredImageForPdf(`${PHOTOS}/ins_1/photo_1.webp`, PHOTOS, "photo"),
  );
  assert.equal(result.format, "jpeg");
});

test("a WebP logo becomes a PNG that keeps its transparency", async () => {
  stored.set("storeA/logo/logo.webp", await image("webp", true));
  const result = decode(
    await pdfImages.readStoreLogoForPdf({ id: "storeA", logoUrl: "/files/storeA/logo/logo.webp" }),
  );
  assert.equal(result.format, "png");
  assert.equal((await sharp(result.bytes).metadata()).hasAlpha, true);
});

test("an AVIF logo becomes a PNG that keeps its transparency", async () => {
  stored.set("storeA/logo/logo.avif", await image("avif", true));
  const result = decode(
    await pdfImages.readStoreLogoForPdf({ id: "storeA", logoUrl: "/files/storeA/logo/logo.avif" }),
  );
  assert.equal(result.format, "png");
  assert.equal((await sharp(result.bytes).metadata()).hasAlpha, true);
});

test("the dark theme's logo is the one a PDF reads", async () => {
  stored.set("storeA/logo/dark.png", await image("png"));
  await pdfImages.readStoreLogoForPdf({
    id: "storeA",
    logoUrl: "/files/storeA/logo/light.png",
    darkLogoUrl: "/files/storeA/logo/dark.png",
    theme: { mode: "dark" },
  });
  assert.deepEqual(
    reads.map((read) => read.key),
    ["storeA/logo/dark.png"],
  );
});

test("a logo stored anywhere but the store's logo folder is never read", async () => {
  for (const logoUrl of [
    null,
    "/files/storeB/logo/logo.png",
    "/files/storeA/products/logo.png",
    "https://cdn.example.com/storeA/logo/logo.png",
    "data:image/png;base64,iVBORw0KGgo=",
  ]) {
    assert.equal(
      await pdfImages.readStoreLogoForPdf({ id: "storeA", logoUrl }),
      null,
      String(logoUrl),
    );
  }
  assert.deepEqual(reads, []);
});

test("an SVG logo renders from its bytes, its external references never loaded", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "image/png" }).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const directory = mkdtempSync(join(tmpdir(), "louez-pdf-svg-"));
  after(() => {
    server.close();
    rmSync(directory, { recursive: true });
  });
  // A green image on disk: drawn over the red background if the file were read.
  const green = join(directory, "green.png");
  writeFileSync(
    green,
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .png()
      .toBuffer(),
  );

  stored.set(
    "storeA/logo/logo.svg",
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100">
  <style>@import url("${origin}/style.css");</style>
  <rect width="200" height="100" fill="#ff0000"/>
  <image href="${origin}/remote.png" x="0" y="0" width="100" height="100"/>
  <image xlink:href="${pathToFileURL(green).href}" x="100" y="0" width="100" height="100"/>
  <image href="${green}" x="100" y="0" width="100" height="100"/>
</svg>`),
  );
  const result = decode(
    await pdfImages.readStoreLogoForPdf({ id: "storeA", logoUrl: "/files/storeA/logo/logo.svg" }),
  );
  assert.equal(result.format, "png");
  assert.deepEqual(await pixel(result.bytes, 50, 50), [255, 0, 0]);
  assert.deepEqual(await pixel(result.bytes, 150, 50), [255, 0, 0]);

  // An external entity makes the whole document unreadable: no logo, nothing fetched.
  stored.set(
    "storeA/logo/entity.svg",
    Buffer.from(`<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY remote SYSTEM "${origin}/entity">]>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&remote;</text></svg>`),
  );
  assert.equal(
    await pdfImages.readStoreLogoForPdf({ id: "storeA", logoUrl: "/files/storeA/logo/entity.svg" }),
    null,
  );
  assert.equal(requests, 0);
});

test("an SVG is never a photo", async () => {
  stored.set(
    `${PHOTOS}/a.svg`,
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
  );
  assert.equal(await pdfImages.readStoredImageForPdf(`${PHOTOS}/a.svg`, PHOTOS, "photo"), null);
});
