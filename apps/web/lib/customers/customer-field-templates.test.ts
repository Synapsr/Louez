import assert from "node:assert/strict";
import { test } from "node:test";

import { customerFieldTemplateAdoptInputSchema } from "@louez/validations";

import { resolveCustomerFieldTemplates } from "./customer-field-templates";

const templates = resolveCustomerFieldTemplates((key) => `label:${key}`);

test("every template is accepted as is by adoptTemplate", () => {
  for (const template of templates) {
    const parsed = customerFieldTemplateAdoptInputSchema.safeParse({
      templateKey: template.id,
      fields: template.fields,
    });
    assert.equal(parsed.success, true, template.id);
  }
});

test("ski and bike fields are recorded per rented unit, for the products the owner picks", () => {
  const itemTemplates = templates.filter((template) => template.scope === "item");
  assert.deepEqual(
    itemTemplates.map((template) => template.id),
    ["ski", "bikes"],
  );
  for (const field of itemTemplates.flatMap((template) => template.fields)) {
    assert.equal(field.scope, "item");
    assert.equal(field.targetMode, "products");
    assert.deepEqual(field.targets, []);
  }
});

test("every other template stays on the customer record, for every reservation", () => {
  for (const field of templates
    .filter((template) => template.scope === "customer")
    .flatMap((template) => template.fields)) {
    assert.equal(field.scope, "customer");
    assert.equal(field.targetMode, "all");
  }
});

test("no template asks the customer by itself", () => {
  for (const field of templates.flatMap((template) => template.fields)) {
    assert.equal(field.collectMode, "never");
    assert.equal(field.customerEditable, false);
  }
});
