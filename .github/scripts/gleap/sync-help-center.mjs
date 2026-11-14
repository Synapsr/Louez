/**
 * Pushes help center articles written in Markdown to Gleap as drafts. It never
 * publishes: an article with an `articleId` gets its draft replaced (the live
 * version stays as it is), an article without one is created unpublished and
 * its new id is printed so it can be written back into the front matter.
 * Publishing stays a click in Gleap.
 *
 *   node .github/scripts/gleap/sync-help-center.mjs docs/help-center/articles
 *
 * Each article is one file per locale, `<key>.<locale>.md`, with front matter:
 * key, locale, collectionId, title, description and, once created, articleId.
 * The working copy lives in docs/help-center/, which Git ignores.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { dryRun, gleap } from "./client.mjs";
import { markdownToTiptap, parseFrontMatter } from "./markdown.mjs";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: sync-help-center.mjs <articles directory>");

const articles = new Map();
for (const file of (await readdir(directory)).filter((name) => name.endsWith(".md")).sort()) {
  const { data, body } = parseFrontMatter(await readFile(path.join(directory, file), "utf8"));
  if (!data.key || !data.locale || !data.collectionId)
    throw new Error(`${file}: key, locale and collectionId are required`);
  const article = articles.get(data.key) ?? {
    collectionId: data.collectionId,
    articleId: undefined,
    title: {},
    description: {},
    content: {},
  };
  if (article.collectionId !== data.collectionId)
    throw new Error(`${file}: collectionId differs between locales`);
  article.articleId ??= data.articleId || undefined;
  article.title[data.locale] = data.title;
  article.description[data.locale] = data.description;
  article.content[data.locale] = markdownToTiptap(body);
  articles.set(data.key, article);
}

for (const [key, { collectionId, articleId, ...fields }] of articles) {
  const base = `/helpcenter/collections/${collectionId}/articles`;
  if (articleId) {
    await gleap("PUT", `${base}/${articleId}/draft`, fields);
    console.log(`${key}: ${dryRun ? "would save" : "saved"} the draft of ${articleId}`);
  } else {
    const created = await gleap("POST", base, {
      ...fields,
      isDraft: true,
      externalId: `louez-hc-${key}`,
    });
    console.log(
      `${key}: ${created ? `created unpublished as ${created.id}, add articleId: ${created.id}` : "would create it unpublished"}`,
    );
  }
}
