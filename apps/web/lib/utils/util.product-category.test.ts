import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  isRoomCategory,
  isRoomProduct,
  isStudioRoomProduct,
  normalizeCategoryToken,
} from "./util.product-category";

describe("util.product-category", () => {
  test("normalizeCategoryToken lowercases and strips accents", () => {
    assert.equal(normalizeCategoryToken(" Pomieszczenia "), "pomieszczenia");
    assert.equal(normalizeCategoryToken("Zażółć"), "zazolc");
  });

  test("isRoomCategory identifies Polish and English room categories", () => {
    assert.equal(isRoomCategory({ name: "Pomieszczenia", slug: "pomieszczenia" }), true);
    assert.equal(isRoomCategory({ name: "Sala konferencyjna", slug: "sala-konferencyjna" }), true);
    assert.equal(isRoomCategory({ name: "Studia fotograficzne", slug: "studia" }), true);
    assert.equal(isRoomCategory({ name: "Rooms", slug: "rooms" }), true);
    assert.equal(isRoomCategory({ name: "Venues", slug: "venues" }), true);
    assert.equal(isRoomCategory({ name: "Aparaty", slug: "aparaty" }), false);
    assert.equal(isRoomCategory(null), false);
    assert.equal(isRoomCategory(undefined), false);
  });

  test("isStudioRoomProduct identifies Studio Foto and Studio Daylight", () => {
    assert.equal(isStudioRoomProduct({ name: "Studio Foto" }), true);
    assert.equal(isStudioRoomProduct({ name: "Studio Daylight" }), true);
    assert.equal(isStudioRoomProduct({ name: "studio daylight" }), true);
    assert.equal(isStudioRoomProduct({ name: "Studio Foto - Duże" }), true);
    assert.equal(isStudioRoomProduct({ name: "Aparat Sony A7 IV" }), false);
    assert.equal(isStudioRoomProduct({ name: "Obiektyw 24-70mm" }), false);
  });

  test("isRoomProduct combines category and studio room checks", () => {
    assert.equal(
      isRoomProduct({
        name: "Dowolny produkt",
        category: { name: "Pomieszczenia", slug: "pomieszczenia" },
      }),
      true,
    );
    assert.equal(
      isRoomProduct({
        name: "Studio Daylight",
        category: null,
      }),
      true,
    );
    assert.equal(
      isRoomProduct({
        name: "Kamera RED",
        category: { name: "Kamery", slug: "kamery" },
      }),
      false,
    );
  });
});
