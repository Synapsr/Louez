import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatCustomerSocialLink,
  getCustomerSocialLinkUrl,
  normalizeCustomerSocialLink,
  normalizeCustomerSocialLinks,
  resolveCustomerSocialLinks,
} from "./customer-social-links";

describe("normalizeCustomerSocialLink", () => {
  test("a handle is stored without its @, whatever was typed", () => {
    assert.equal(normalizeCustomerSocialLink("instagram", "@thomas.lefevre"), "thomas.lefevre");
    assert.equal(normalizeCustomerSocialLink("instagram", "  thomas.lefevre "), "thomas.lefevre");
    assert.equal(normalizeCustomerSocialLink("tiktok", "@ski_pro"), "ski_pro");
  });

  test("a pasted profile URL is reduced to the handle", () => {
    assert.equal(
      normalizeCustomerSocialLink("instagram", "https://www.instagram.com/thomas.lefevre/?hl=fr"),
      "thomas.lefevre",
    );
    assert.equal(normalizeCustomerSocialLink("tiktok", "tiktok.com/@ski_pro"), "ski_pro");
    assert.equal(
      normalizeCustomerSocialLink("linkedin", "https://linkedin.com/in/marie-caron-123/"),
      "marie-caron-123",
    );
    assert.equal(normalizeCustomerSocialLink("x", "https://twitter.com/louez_io"), "louez_io");
    assert.equal(normalizeCustomerSocialLink("youtube", "youtube.com/@louez"), "louez");
  });

  test("a URL of another site is kept as typed rather than mangled into a handle", () => {
    assert.equal(
      normalizeCustomerSocialLink("instagram", "https://example.com/someone"),
      "https://example.com/someone",
    );
  });

  test("a website becomes a full URL and WhatsApp an international number", () => {
    assert.equal(normalizeCustomerSocialLink("website", "louez.io/"), "https://louez.io");
    assert.equal(
      normalizeCustomerSocialLink("website", "http://shop.example.com/a"),
      "http://shop.example.com/a",
    );
    assert.equal(normalizeCustomerSocialLink("whatsapp", "+33 6 12 34 56 78"), "+33612345678");
    assert.equal(
      normalizeCustomerSocialLink("whatsapp", "https://wa.me/33612345678"),
      "+33612345678",
    );
  });

  test("blank input is null", () => {
    assert.equal(normalizeCustomerSocialLink("instagram", "   "), null);
    assert.equal(normalizeCustomerSocialLink("instagram", null), null);
    assert.equal(normalizeCustomerSocialLink("whatsapp", "abc"), null);
  });
});

describe("display helpers", () => {
  test("URL and label of a stored link", () => {
    assert.equal(getCustomerSocialLinkUrl("instagram", "thomas"), "https://instagram.com/thomas");
    assert.equal(getCustomerSocialLinkUrl("tiktok", "ski_pro"), "https://tiktok.com/@ski_pro");
    assert.equal(getCustomerSocialLinkUrl("whatsapp", "+33612345678"), "https://wa.me/33612345678");
    assert.equal(formatCustomerSocialLink("instagram", "thomas"), "@thomas");
    assert.equal(formatCustomerSocialLink("website", "https://www.louez.io"), "louez.io");
  });

  test("links are listed in network order with blanks dropped, and normalised as a whole", () => {
    assert.deepEqual(
      resolveCustomerSocialLinks({ website: "https://a.io", instagram: "b", x: " " }),
      [
        { network: "instagram", value: "b" },
        { network: "website", value: "https://a.io" },
      ],
    );
    assert.deepEqual(normalizeCustomerSocialLinks({ instagram: "@b", facebook: "" }), {
      instagram: "b",
    });
    assert.equal(normalizeCustomerSocialLinks({ instagram: " " }), null);
    assert.equal(normalizeCustomerSocialLinks(null), null);
  });
});
