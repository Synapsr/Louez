import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_CRAWLERS,
  AI_ROBOTS_TOKENS,
  aiCrawlerOf,
  classifyAiCrawler,
  classifyAiReferral,
  parseAiAssistant,
} from "./ai-visibility";

test("a visit's referrer names the assistant it came from", () => {
  assert.equal(classifyAiReferral({ referrer: "https://chatgpt.com/" }), "chatgpt");
  assert.equal(classifyAiReferral({ referrer: "https://chat.openai.com/c/abc" }), "chatgpt");
  assert.equal(classifyAiReferral({ referrer: "https://www.perplexity.ai/search?q=x" }), "perplexity");
  assert.equal(classifyAiReferral({ referrer: "https://claude.ai/" }), "claude");
  assert.equal(classifyAiReferral({ referrer: "https://gemini.google.com/app" }), "gemini");
  assert.equal(classifyAiReferral({ referrer: "https://copilot.microsoft.com/" }), "copilot");
  assert.equal(classifyAiReferral({ referrer: "https://chat.mistral.ai/chat" }), "mistral");
});

test("ChatGPT's utm_source names it when the referrer is gone", () => {
  assert.equal(classifyAiReferral({ referrer: "", utmSource: "chatgpt.com" }), "chatgpt");
  assert.equal(classifyAiReferral({ referrer: null, utmSource: "perplexity" }), "perplexity");
  assert.equal(classifyAiReferral({ utmSource: "Copilot.Microsoft.com" }), "copilot");
});

test("any other visit is no assistant's", () => {
  assert.equal(classifyAiReferral({ referrer: "https://www.google.com/" }), null);
  // Google Search is not Gemini, nor a lookalike domain an assistant.
  assert.equal(classifyAiReferral({ referrer: "https://google.com/search?q=gemini" }), null);
  assert.equal(classifyAiReferral({ referrer: "https://notchatgpt.com/" }), null);
  assert.equal(classifyAiReferral({ referrer: "not a url", utmSource: "newsletter" }), null);
  assert.equal(classifyAiReferral({}), null);
});

test("a crawler is told by its user agent's token, case aside", () => {
  const ua = (token: string) => `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ${token}/1.0; +https://example.com/bot)`;
  assert.equal(classifyAiCrawler(ua("GPTBot"))?.key, "gptbot");
  assert.equal(classifyAiCrawler(ua("OAI-SearchBot"))?.key, "oai_searchbot");
  assert.equal(classifyAiCrawler(ua("ChatGPT-User"))?.key, "chatgpt_user");
  assert.equal(classifyAiCrawler(ua("ClaudeBot"))?.assistant, "claude");
  assert.equal(classifyAiCrawler(ua("Claude-User"))?.purpose, "user");
  assert.equal(classifyAiCrawler(ua("PerplexityBot"))?.key, "perplexitybot");
  assert.equal(classifyAiCrawler(ua("perplexity-user"))?.key, "perplexity_user");
  assert.equal(classifyAiCrawler(ua("CCBot"))?.assistant, "other");
});

test("browsers and search engines are not AI crawlers", () => {
  assert.equal(
    classifyAiCrawler(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    ),
    null,
  );
  assert.equal(
    classifyAiCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    null,
  );
  assert.equal(classifyAiCrawler(null), null);
  assert.equal(classifyAiCrawler(""), null);
});

test("crawler keys are unique and fit their column; robots.txt names every crawler", () => {
  const keys = AI_CRAWLERS.map((crawler) => crawler.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const crawler of AI_CRAWLERS) {
    assert.ok(crawler.key.length <= 32, crawler.key);
    assert.equal(aiCrawlerOf(crawler.key), crawler);
    assert.ok(AI_ROBOTS_TOKENS.includes(crawler.token), crawler.token);
  }
  assert.ok(AI_ROBOTS_TOKENS.includes("Google-Extended"));
  assert.equal(aiCrawlerOf("retired_bot"), null);
});

test("only listed assistants are kept", () => {
  assert.equal(parseAiAssistant("chatgpt"), "chatgpt");
  assert.equal(parseAiAssistant("other"), "other");
  assert.equal(parseAiAssistant("bing"), null);
  assert.equal(parseAiAssistant(undefined), null);
});
