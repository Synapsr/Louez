import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  groupFieldsBySection,
  moveFieldToSection,
  moveItem,
  toReorderPayload,
} from "./util.customer-fields";

const field = (id: string, section: string, position: number) => ({ id, section, position });

describe("groupFieldsBySection", () => {
  test("a section sits where its first field does, fields keep their order", () => {
    const sections = groupFieldsBySection([
      field("c", "Permis", 3),
      field("a", "Identité", 1),
      field("d", "Identité", 4),
      field("b", "Permis", 2),
    ]);
    assert.deepEqual(
      sections.map((section) => [section.name, section.fields.map((entry) => entry.id)]),
      [
        ["Identité", ["a", "d"]],
        ["Permis", ["b", "c"]],
      ],
    );
    assert.deepEqual(toReorderPayload(sections), [
      { id: "a", section: "Identité" },
      { id: "d", section: "Identité" },
      { id: "b", section: "Permis" },
      { id: "c", section: "Permis" },
    ]);
  });
});

describe("moveItem", () => {
  test("moves without mutating, ignores out-of-range indexes", () => {
    const items = ["a", "b", "c"];
    assert.deepEqual(moveItem(items, 0, 2), ["b", "c", "a"]);
    assert.deepEqual(moveItem(items, 2, 0), ["c", "a", "b"]);
    assert.deepEqual(moveItem(items, 1, 5), ["a", "b", "c"]);
    assert.deepEqual(items, ["a", "b", "c"]);
  });
});

describe("moveFieldToSection", () => {
  const sections = groupFieldsBySection([field("a", "Identité", 1), field("b", "Permis", 2)]);

  test("appends to an existing section and drops the emptied one", () => {
    assert.deepEqual(
      moveFieldToSection(sections, "a", "Permis").map((section) => [
        section.name,
        section.fields.map((entry) => entry.id),
      ]),
      [["Permis", ["b", "a"]]],
    );
  });

  test("creates the target section when it is new", () => {
    assert.deepEqual(
      moveFieldToSection(sections, "b", "Mensurations").map((section) => section.name),
      ["Identité", "Mensurations"],
    );
  });
});
