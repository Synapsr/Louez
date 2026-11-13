import assert from "node:assert/strict";
import test from "node:test";

import { inline, markdownToTiptap, parseFrontMatter } from "./markdown.mjs";

test("front matter is read and removed from the body", () => {
  const { data, body } = parseFrontMatter('---\nkey: a\ntitle: "B: c"\n---\nHello\n');
  assert.deepEqual(data, { key: "a", title: "B: c" });
  assert.equal(body, "Hello\n");
});

test("inline bold, code and links become marks", () => {
  assert.deepEqual(inline("a **b** `c` [d](https://e.f)"), [
    { type: "text", text: "a " },
    { type: "text", text: "b", marks: [{ type: "bold" }] },
    { type: "text", text: " " },
    { type: "text", text: "c", marks: [{ type: "code" }] },
    { type: "text", text: " " },
    {
      type: "text",
      text: "d",
      marks: [{ type: "link", attrs: { href: "https://e.f", target: "_blank" } }],
    },
  ]);
});

test("blocks: heading, paragraph, nested list, code", () => {
  const doc = markdownToTiptap(
    "## Title\n\nOne\nline.\n\n1. First\n   - sub\n2. Second\n\n```bash\nls\n```\n",
  );
  assert.deepEqual(
    doc.content.map((node) => node.type),
    ["heading", "paragraph", "orderedList", "codeBlock"],
  );
  assert.equal(doc.content[1].content[0].text, "One line.");
  assert.equal(doc.content[2].content.length, 2);
  assert.equal(doc.content[2].content[0].content[1].type, "bulletList");
  assert.deepEqual(doc.content[3], {
    type: "codeBlock",
    attrs: { language: "bash" },
    content: [{ type: "text", text: "ls" }],
  });
});

test("a numbered list split by a code block keeps its numbering", () => {
  const doc = markdownToTiptap("1. One\n2. Two\n\n```\nx\n```\n\n3. Three\n");
  assert.equal(doc.content[0].attrs, undefined);
  assert.deepEqual(doc.content[2].attrs, { start: 3 });
});
