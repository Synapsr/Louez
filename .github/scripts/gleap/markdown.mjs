/**
 * The small Markdown subset help center articles use, turned into the TipTap
 * documents Gleap stores: front matter, `##`/`###` headings, paragraphs,
 * bullet and numbered lists (one nested level), fenced code, and inline bold,
 * code and links. Anything else stays plain text, so a new construct shows up
 * in review instead of disappearing.
 */

/** Splits `---` front matter (flat `key: value` lines) from the body. */
export function parseFrontMatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return { data: {}, body: source };
  const data = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    let value = line.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    data[line.slice(0, separator).trim()] = value;
  }
  return { data, body: source.slice(match[0].length) };
}

const INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;

/** Inline Markdown to TipTap text nodes. */
export function inline(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) nodes.push({ type: "text", text: text.slice(last, match.index) });
    if (match[1]) nodes.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
    else if (match[3]) nodes.push({ type: "text", text: match[4], marks: [{ type: "code" }] });
    else
      nodes.push({
        type: "text",
        text: match[6],
        marks: [{ type: "link", attrs: { href: match[7], target: "_blank" } }],
      });
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

const paragraph = (text) => ({ type: "paragraph", content: inline(text) });
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function parseList(lines, start) {
  const ordered = /^\d+\./.test(LIST_ITEM.exec(lines[start])[2]);
  const items = [];
  let index = start;
  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index]);
    if (!match || match[1].length > 0) break;
    if (/^\d+\./.test(match[2]) !== ordered) break;
    const item = { type: "listItem", content: [paragraph(match[3])] };
    index += 1;
    const nested = [];
    while (index < lines.length && LIST_ITEM.exec(lines[index])?.[1].length > 0) {
      nested.push(lines[index].trimStart());
      index += 1;
    }
    if (nested.length > 0) item.content.push(parseList(nested, 0).node);
    items.push(item);
  }
  if (!ordered) return { node: { type: "bulletList", content: items }, next: index };
  // A list split by a code block goes on numbering where it left off.
  const first = Number.parseInt(LIST_ITEM.exec(lines[start])[2], 10);
  const node = { type: "orderedList", content: items };
  if (first !== 1) node.attrs = { start: first };
  return { node, next: index };
}

/** A Markdown body to a TipTap `doc`. */
export function markdownToTiptap(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // the closing fence
      content.push({
        type: "codeBlock",
        attrs: { language: fence[1] || null },
        content: [{ type: "text", text: code.join("\n") }],
      });
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: inline(heading[2]),
      });
      index += 1;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const list = parseList(lines, index);
      content.push(list.node);
      index = list.next;
      continue;
    }
    const text = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !/^(#{2,3}\s|```)/.test(lines[index]) &&
      !LIST_ITEM.test(lines[index])
    ) {
      text.push(lines[index].trim());
      index += 1;
    }
    content.push(paragraph(text.join(" ")));
  }
  return { type: "doc", content };
}
