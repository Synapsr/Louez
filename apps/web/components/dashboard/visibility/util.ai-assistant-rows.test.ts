import assert from "node:assert/strict";
import { test } from "node:test";

import { toAiAssistantRows } from "./util.ai-assistant-rows";

test("an assistant with visits or reads gets one row, the most visits then reads first", () => {
  assert.deepEqual(
    toAiAssistantRows({
      visits: {
        total: 3,
        byAssistant: [
          { assistant: "perplexity", visits: 2 },
          { assistant: "chatgpt", visits: 1 },
        ],
      },
      crawls: {
        total: 31,
        llmsTxt: 0,
        byAssistant: [
          { assistant: "chatgpt", hits: 24 },
          { assistant: "claude", hits: 7 },
        ],
      },
    }),
    [
      { assistant: "perplexity", visits: 2, hits: 0 },
      { assistant: "chatgpt", visits: 1, hits: 24 },
      { assistant: "claude", visits: 0, hits: 7 },
    ],
  );
});

test("nothing seen is no row", () => {
  assert.deepEqual(
    toAiAssistantRows({
      visits: { total: 0, byAssistant: [] },
      crawls: { total: 0, llmsTxt: 0, byAssistant: [] },
    }),
    [],
  );
});
