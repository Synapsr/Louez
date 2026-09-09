import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildStoreThemeStyle,
  getContrastForeground,
  getStoreThemeClassName,
  getStoreThemeVariables,
  hexToOklch,
  parseHexColor,
} from "./util.store-theme";

const OKLCH_PATTERN = /^oklch\((-?[\d.]+) ([\d.]+) ([\d.]+)\)$/;

const parseOklch = (value: string | null) => {
  assert.ok(value, "expected an oklch string");
  const match = value.match(OKLCH_PATTERN);
  assert.ok(match, `not an oklch string: ${value}`);

  return {
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
  };
};

const assertClose = (actual: number, expected: number, tolerance: number, label: string) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
};

test("parseHexColor accepts long, short and hashless forms", () => {
  assert.deepEqual(parseHexColor("#0066FF"), { r: 0, g: 102, b: 255 });
  assert.deepEqual(parseHexColor("0066ff"), { r: 0, g: 102, b: 255 });
  assert.deepEqual(parseHexColor("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHexColor(" #1a2b3c "), { r: 26, g: 43, b: 60 });
});

test("parseHexColor rejects malformed input", () => {
  assert.equal(parseHexColor(""), null);
  assert.equal(parseHexColor("#12"), null);
  assert.equal(parseHexColor("#12345"), null);
  assert.equal(parseHexColor("#gggggg"), null);
  assert.equal(parseHexColor("rgb(0 0 0)"), null);
});

test("hexToOklch matches reference values for the sRGB primaries", () => {
  const red = parseOklch(hexToOklch("#ff0000"));
  assertClose(red.l, 0.628, 0.005, "red L");
  assertClose(red.c, 0.258, 0.005, "red C");
  assertClose(red.h, 29.2, 0.5, "red H");

  const green = parseOklch(hexToOklch("#00ff00"));
  assertClose(green.l, 0.866, 0.005, "green L");
  assertClose(green.c, 0.295, 0.005, "green C");
  assertClose(green.h, 142.5, 0.5, "green H");

  const blue = parseOklch(hexToOklch("#0000ff"));
  assertClose(blue.l, 0.452, 0.005, "blue L");
  assertClose(blue.c, 0.313, 0.005, "blue C");
  assertClose(blue.h, 264.1, 0.5, "blue H");
});

test("hexToOklch keeps white and black achromatic", () => {
  const white = parseOklch(hexToOklch("#ffffff"));
  assertClose(white.l, 1, 0.001, "white L");
  assertClose(white.c, 0, 0.001, "white C");

  const black = parseOklch(hexToOklch("#000000"));
  assertClose(black.l, 0, 0.001, "black L");
  assertClose(black.c, 0, 0.001, "black C");
});

test("hexToOklch uses the same rounding as the former ThemeWrapper", () => {
  // 3 decimals for L and C, 1 for H: the string a store already renders with.
  assert.match(hexToOklch("#0066FF") ?? "", /^oklch\(\d\.\d{3} \d\.\d{3} \d+\.\d\)$/);
});

test("hexToOklch returns null for an invalid colour", () => {
  assert.equal(hexToOklch("#12345"), null);
  assert.equal(hexToOklch("teal"), null);
});

test("getContrastForeground picks dark text above the 0.55 luma threshold", () => {
  assert.equal(getContrastForeground("#ffffff"), "oklch(0.205 0 0)");
  assert.equal(getContrastForeground("#ffd500"), "oklch(0.205 0 0)");
  assert.equal(getContrastForeground("#000000"), "oklch(0.985 0 0)");
  assert.equal(getContrastForeground("#0066ff"), "oklch(0.985 0 0)");
  // Medium pink: luma 0.55–0.6 territory where white still reads better.
  assert.equal(getContrastForeground("#e0559b"), "oklch(0.985 0 0)");
  assert.equal(getContrastForeground("nope"), null);
});

test("getStoreThemeVariables mirrors the primary onto the ring", () => {
  const variables = getStoreThemeVariables({ mode: "light", primaryColor: "#0066FF" });

  assert.ok(variables);
  assert.equal(variables["--ring"], variables["--primary"]);
  assert.equal(variables["--primary-foreground"], "oklch(0.985 0 0)");
  // "bad" would be a legal 3-digit hex; use something that cannot parse.
  assert.equal(getStoreThemeVariables({ mode: "light", primaryColor: "nope" }), null);
});

test("buildStoreThemeStyle emits one rule that wins in every mode", () => {
  const css = buildStoreThemeStyle({ mode: "dark", primaryColor: "#0066FF" });

  assert.ok(css.startsWith(":root,.dark,.light{"));
  assert.ok(css.endsWith("}"));
  assert.match(css, /--primary:oklch\([^)]+\);/);
  assert.match(css, /--primary-foreground:oklch\(0\.985 0 0\);/);
  assert.match(css, /--ring:oklch\([^)]+\)}/);
  assert.equal(css.includes("\n"), false);
});

test("buildStoreThemeStyle stays silent on an invalid colour", () => {
  assert.equal(buildStoreThemeStyle({ mode: "light", primaryColor: "" }), "");
});

test("getStoreThemeClassName only adds the dark class", () => {
  assert.equal(getStoreThemeClassName("dark"), "dark");
  assert.equal(getStoreThemeClassName("light"), undefined);
});
