import assert from "node:assert/strict";
import { test } from "node:test";
import { Backend } from "./backend.js";
import type { ToolResult, Usage } from "@louez/voice/protocol";

test("completed function items execute once, all results precede continuation", async () => {
  const sent: unknown[] = [];
  const called: string[] = [];
  const metered: Usage[] = [];
  const backend = new Backend({
    send: (event) => sent.push(event),
    execute: async (call) => {
      called.push(call.id);
      return { output: { ok: true } };
    },
    recordUsage: (_, usage) => metered.push(usage),
    control: () => assert.fail("Unexpected control"),
  });
  await backend.handle("d1", { type: "response.created", response: { id: "r1" } });
  await backend.handle("d1", { type: "response.function_call_arguments.done", arguments: "{}" });
  assert.equal(called.length, 0);
  for (const id of ["a", "b", "a"])
    await backend.handle("d1", {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: id,
        name: "list_products",
        arguments: "{}",
      },
    });
  assert.equal(called.length, 0);
  const completion = {
    type: "response.completed",
    response: {
      id: "r1",
      output: [],
      usage: {
        input_tokens: 25,
        output_tokens: 8,
        input_tokens_details: { cached_tokens: 10 },
      },
    },
  };
  await backend.handle("d1", completion);
  await backend.handle("d1", completion);
  assert.deepEqual(called, ["a", "b"]);
  assert.deepEqual(sent, [
    {
      type: "response.item.create",
      item: { type: "function_call_output", call_id: "a", output: '{"ok":true}' },
    },
    {
      type: "response.item.create",
      item: { type: "function_call_output", call_id: "b", output: '{"ok":true}' },
    },
    { type: "response.create" },
  ]);
  assert.deepEqual(metered, [{ inputTokens: 25, outputTokens: 8, cachedInputTokens: 10 }]);
});

test("ending a call suppresses late backend output without claiming its action was cancelled", async () => {
  let finish: (value: ToolResult) => void = () => {};
  const executing = new Promise<ToolResult>((resolve) => {
    finish = resolve;
  });
  const sent: unknown[] = [];
  const backend = new Backend({
    send: (event) => sent.push(event),
    execute: () => executing,
    recordUsage: () => {},
    control: () => assert.fail("Unexpected control"),
  });
  await backend.handle("d1", { type: "response.created", response: { id: "r1" } });
  await backend.handle("d1", {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: "a",
      name: "create_reservation_hold",
      arguments: "{}",
    },
  });
  const work = backend.handle("d1", { type: "response.completed", response: { id: "r1" } });
  await Promise.resolve();
  backend.stop();
  finish({ output: { ok: true } });
  await work;
  assert.deepEqual(sent, []);
});

test("backend failure records available usage and never executes unfinished writes", async () => {
  const backend = new Backend({
    send: () => assert.fail(),
    execute: async () => {
      assert.fail();
    },
    recordUsage: () => {},
    control: () => assert.fail(),
  });
  await backend.handle("d1", { type: "response.created", response: { id: "r1" } });
  await backend.handle("d1", {
    type: "response.output_item.done",
    item: { type: "function_call", call_id: "a", name: "book", arguments: "{}" },
  });
  await assert.rejects(
    backend.handle("d1", { type: "response.failed", response: { id: "r1" } }),
    /failed/,
  );
});

test("transfer submits its result and hands off without starting another backend response", async () => {
  const sent: unknown[] = [];
  const controls: string[] = [];
  const backend = new Backend({
    send: (event) => sent.push(event),
    execute: async () => ({ output: { ok: true }, control: "transfer" }),
    recordUsage: () => {},
    control: (action) => controls.push(action),
  });
  await backend.handle("d1", { type: "response.created", response: { id: "r1" } });
  await backend.handle("d1", {
    type: "response.output_item.done",
    item: { type: "function_call", call_id: "a", name: "transfer_to_human", arguments: "{}" },
  });
  await backend.handle("d1", { type: "response.completed", response: { id: "r1" } });
  assert.deepEqual(controls, ["transfer"]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    type: "response.item.create",
    item: { type: "function_call_output", call_id: "a", output: '{"ok":true}' },
  });
});
