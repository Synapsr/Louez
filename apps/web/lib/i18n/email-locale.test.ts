import assert from "node:assert/strict";
import { test } from "node:test";
import { getEmailLocaleFromHeaders } from "@louez/email/locale";

test("auth emails follow an explicit supported cookie", () => {
  assert.equal(
    getEmailLocaleFromHeaders(
      new Headers({ cookie: "session=opaque; NEXT_LOCALE=ko", "accept-language": "fr" }),
    ),
    "ko",
  );
});

test("auth emails resolve all new browser languages and weights", () => {
  for (const [tag, locale] of [
    ["zh-CN", "zh"],
    ["ja-JP", "ja"],
    ["ru-RU", "ru"],
    ["id-ID", "id"],
    ["ko-KR", "ko"],
  ]) {
    assert.equal(
      getEmailLocaleFromHeaders(new Headers({ "accept-language": `${tag},en;q=0.5` })),
      locale,
    );
  }
  assert.equal(
    getEmailLocaleFromHeaders(new Headers({ "accept-language": "fr;q=0,ru;q=0.8,en;q=0.5" })),
    "ru",
  );
});

test("invalid cookies and unsupported preferences cannot select a catalog", () => {
  assert.equal(
    getEmailLocaleFromHeaders(
      new Headers({ cookie: "NEXT_LOCALE=../../secret", "accept-language": "ar" }),
    ),
    "fr",
  );
});
