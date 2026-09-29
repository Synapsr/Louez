import assert from "node:assert/strict";
import test from "node:test";

import { demo as comparisonDemo } from "@/components/landing-demos/features/inspection-compare.demo";
import { demo as itemsDemo } from "@/components/landing-demos/features/inspection-items.demo";
import { demo as settingsDemo } from "@/components/landing-demos/features/inspection-settings.demo";
import { demo as wizardDemo } from "@/components/landing-demos/features/inspection-wizard.demo";
import { locales } from "@/i18n/config";
import { createDemoPeriod, getDemoProducts } from "@/lib/landing-demos/fixtures";
import {
  createDemoInspectionComparison,
  createDemoInspectionWizard,
  DEMO_INSPECTION_STORE,
} from "@/lib/landing-demos/inspections";
import { getDemoCustomer, getDemoToday } from "@/lib/landing-demos/reservations";
import { getInspectionDemoText } from "@/lib/landing-demos/text.inspections";

test("two individual bikes share the reservation line but retain their own photos and notes", () => {
  const wizard = createDemoInspectionWizard("fr", 1);
  const customer = getDemoCustomer(0);
  assert.equal(wizard.customerName, `${customer.firstName} ${customer.lastName}`);
  assert.equal(wizard.type, "departure");
  assert.equal(wizard.readOnly, true);
  assert.equal(wizard.requireSignature, true);
  assert.equal(wizard.items.length, 2);
  assert.equal(new Set(wizard.items.map((item) => item.reservationItemId)).size, 1);
  assert.equal(new Set(wizard.items.map((item) => item.productUnitId)).size, 2);
  assert.equal(new Set(wizard.items.map((item) => item.unitIdentifier)).size, 2);
  for (const [index, item] of wizard.items.entries()) {
    assert.equal(item.quantity, 1);
    const inspection = wizard.initialInspections?.[item.id];
    assert.ok(inspection);
    assert.equal(inspection.condition, "ok");
    assert.equal(inspection.photos.length, 1);
    assert.equal(inspection.photos[0].url, item.product.images[0]);
    assert.ok(inspection.photos[0].key.startsWith("demo-inspections/"));
    assert.equal(inspection.notes, index === 1 ? getInspectionDemoText("fr").wearNote : "");
  }
  assert.equal(DEMO_INSPECTION_STORE.id, "demo-store");
  assert.equal(DEMO_INSPECTION_STORE.settings.inspection.enabled, true);
});

test("fixture state can be edited without contaminating the next loop", () => {
  const first = createDemoInspectionWizard();
  const firstItem = first.items[0];
  const inspection = first.initialInspections?.[firstItem.id];
  assert.ok(inspection);
  inspection.photos.length = 0;
  inspection.condition = "damage";
  firstItem.product.images.length = 0;
  const second = createDemoInspectionWizard();
  assert.equal(second.initialInspections?.[firstItem.id].condition, "ok");
  assert.equal(second.initialInspections?.[firstItem.id].photos.length, 1);
  assert.ok(second.items[0].product.images.length > 0);
});

test("comparison matches each unit in a family hire and changes exactly one condition", () => {
  const period = createDemoPeriod();
  const startBefore = period.start.getTime();
  const { departure, return_: returned } = createDemoInspectionComparison(period);
  assert.ok(departure && returned);
  assert.equal(departure.items.length, 4);
  assert.equal(returned.items.length, 4);
  assert.equal(departure.hasDamage, false);
  assert.equal(returned.hasDamage, true);
  const changed = returned.items.filter((item) => {
    const previous = departure.items.find(
      (candidate) => candidate.unitIdentifier === item.unitIdentifier,
    );
    assert.ok(previous);
    assert.equal(item.productName, previous.productName);
    assert.ok(item.photos.length > 0 && previous.photos.length > 0);
    return previous.condition !== item.condition;
  });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].unitIdentifier, "V-002");
  assert.equal(changed[0].condition, "damaged");
  assert.ok(changed[0].notes);
  assert.ok(departure.hasSignature && returned.hasSignature);
  assert.ok(departure.createdAt < returned.createdAt);
  assert.ok(departure.signedAt && departure.signedAt > departure.createdAt);
  assert.ok(returned.signedAt && returned.signedAt > returned.createdAt);
  assert.equal(returned.createdAt.toDateString(), getDemoToday(period).toDateString());
  assert.equal(period.start.getTime(), startBefore);

  const laterStart = new Date(period.start);
  laterStart.setDate(laterStart.getDate() + 30);
  const laterEnd = new Date(period.end);
  laterEnd.setDate(laterEnd.getDate() + 30);
  const laterPeriod = { start: laterStart, end: laterEnd };
  const later = createDemoInspectionComparison(laterPeriod);
  assert.equal(later.return_?.createdAt.toDateString(), getDemoToday(laterPeriod).toDateString());
  assert.notEqual(later.departure?.createdAt.getTime(), departure.createdAt.getTime());
});

test("all eight locales translate inspection notes and products while keeping French identities", () => {
  const period = createDemoPeriod();
  const french = createDemoInspectionWizard("fr");
  for (const locale of locales) {
    const text = getInspectionDemoText(locale);
    assert.ok(Object.values(text).every((value) => value.length > 0));
    if (locale !== "fr") assert.notEqual(text.wearNote, getInspectionDemoText("fr").wearNote);
    const wizard = createDemoInspectionWizard(locale);
    const comparison = createDemoInspectionComparison(period, locale);
    assert.equal(wizard.customerName, french.customerName);
    assert.equal(wizard.items[0].product.name, getDemoProducts(locale)[0].name);
    assert.equal(wizard.initialInspections?.[wizard.items[0].id].notes, text.wearNote);
    assert.equal(comparison.return_?.items[1].notes, text.damageNote);
    assert.deepEqual(
      wizard.items.map((item) => item.id),
      french.items.map((item) => item.id),
    );
  }
});

test("inspection scripts approach real controls before acting and finish gestures inside short loops", () => {
  for (const demo of [wizardDemo, itemsDemo, comparisonDemo, settingsDemo]) {
    assert.equal(demo.actor, "owner");
    assert.ok(demo.duration >= 5000 && demo.duration < 12000);
    let previousAt = -1;
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at > previousAt && cue.at < demo.duration);
      assert.ok(cue.selector.startsWith("[data-"));
      assert.ok(!cue.selector.includes("aria-label"));
      if (cue.click || cue.press || cue.scroll || cue.draw || cue.type || cue.emit || cue.hover) {
        const approach = demo.cues[index - 1];
        assert.ok(approach);
        assert.equal(approach.selector, cue.selector);
        assert.ok(!approach.click && !approach.press && !approach.scroll && !approach.draw);
        assert.ok(cue.at - approach.at >= 700 && cue.at - approach.at <= 900);
      }
      const gestureDuration = cue.draw?.duration ?? cue.type?.duration ?? cue.scroll?.duration ?? 0;
      assert.ok(cue.at + gestureDuration < demo.duration);
      if (gestureDuration)
        assert.ok(cue.at + gestureDuration < (demo.cues[index + 1]?.at ?? demo.duration));
      previousAt = cue.at;
    }
  }
  assert.equal(wizardDemo.format, "phone");
  assert.equal(itemsDemo.format, "phone");
  assert.ok(wizardDemo.cues.some((cue) => cue.draw));
});
