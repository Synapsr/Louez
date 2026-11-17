import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  formatStudioAttributes,
  initialStudioBookingValues,
  type StudioBookingValues,
  validateStudioBookingValues,
} from "./util.studio-booking";

describe("util.studio-booking", () => {
  test("initialStudioBookingValues is invalid initially", () => {
    const res = validateStudioBookingValues(initialStudioBookingValues);
    assert.equal(res.isValid, false);
    assert.ok(res.errors.clientPresenceHours);
    assert.ok(res.errors.productionHours);
    assert.ok(res.errors.coffeePackage);
    assert.ok(res.errors.rentalType);
    assert.ok(res.errors.equipmentOption);
    assert.ok(res.errors.furnitureOption);
    assert.ok(res.errors.cycloramaClean);
    assert.ok(res.errors.cycloramaRefresh);
  });

  test("validates complete form without equipment or furniture", () => {
    const values: StudioBookingValues = {
      clientPresenceHours: "08:00 - 18:00",
      productionHours: "09:00 - 17:00",
      coffeePackage: "nie",
      rentalType: "wynajem",
      equipmentOption: "nie",
      equipmentDetails: "",
      furnitureOption: "nie",
      furnitureDetails: "",
      cycloramaClean: "nie",
      cycloramaRefresh: "nie_dotyczy",
    };

    const res = validateStudioBookingValues(values);
    assert.equal(res.isValid, true);
    assert.deepEqual(res.errors, {});

    const formatted = formatStudioAttributes(values);
    assert.equal(formatted["Godziny obecności klienta"], "08:00 - 18:00");
    assert.equal(formatted["Godziny zdjęć/produkcji"], "09:00 - 17:00");
    assert.equal(formatted["Pakiet kawowy (powyżej 8os.)"], "Nie");
    assert.equal(formatted["Sam wynajem czy support"], "Sam wynajem studia");
    assert.equal(formatted["Sprzęt foto/video"], "Nie");
    assert.equal(formatted["Potrzebne meble"], "Nie");
    assert.equal(formatted["Cyklorama na czysto (malowana)"], "Nie");
    assert.equal(formatted["Odświeżenie cykloramy między dniami"], "Nie dotyczy");
  });

  test("requires equipment details when equipmentOption is tak", () => {
    const values: StudioBookingValues = {
      clientPresenceHours: "08:00 - 18:00",
      productionHours: "09:00 - 17:00",
      coffeePackage: "tak",
      rentalType: "support",
      equipmentOption: "tak",
      equipmentDetails: "   ",
      furnitureOption: "nie",
      furnitureDetails: "",
      cycloramaClean: "tak",
      cycloramaRefresh: "tak",
    };

    const res = validateStudioBookingValues(values);
    assert.equal(res.isValid, false);
    assert.ok(res.errors.equipmentDetails);

    values.equipmentDetails = "Statywy i lampy Profoto";
    const res2 = validateStudioBookingValues(values);
    assert.equal(res2.isValid, true);

    const formatted = formatStudioAttributes(values);
    assert.equal(formatted["Sprzęt foto/video"], "Tak: Statywy i lampy Profoto");
    assert.equal(formatted["Pakiet kawowy (powyżej 8os.)"], "Tak");
    assert.equal(formatted["Sam wynajem czy support"], "Support eN");
  });
});
