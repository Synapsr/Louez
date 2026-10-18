import type { ToolResult, Usage } from "@louez/voice/protocol";
import { responseEventSchema } from "./events.js";

type Call = { id: string; name: string; arguments: string };
type PendingResponse = { id: string; calls: Call[] };
type BackendOptions = {
  send: (event: unknown) => void;
  execute: (call: Call) => Promise<ToolResult>;
  recordUsage: (id: string, usage: Usage) => void;
  control: (action: "end" | "transfer") => void;
};

// Only complete output items carry callable arguments. Lifecycle snapshots in
// GPT-Live deliberately omit their output arrays. Never execute partial deltas.
export class Backend {
  private pending = new Map<string, PendingResponse>();
  private completed = new Set<string>();
  private executed = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(private readonly options: BackendOptions) {}

  stop() {
    this.stopped = true;
  }

  handle(delegation: string, raw: unknown): Promise<void> {
    const parsed = responseEventSchema.safeParse(raw);
    if (!parsed.success) return Promise.resolve();
    const event = parsed.data;
    if (event.type === "response.created") {
      if (this.pending.size >= 20) return Promise.reject(new Error("Too many backend responses"));
      if (this.pending.get(delegation)?.id === event.response.id) return Promise.resolve();
      this.pending.set(delegation, { id: event.response.id, calls: [] });
      return Promise.resolve();
    }
    if (event.type === "response.output_item.done") {
      const item = event.item;
      const pending = this.pending.get(delegation);
      if (
        item.type === "function_call" &&
        pending &&
        item.call_id &&
        item.name &&
        item.arguments !== undefined
      ) {
        if (!pending.calls.some((call) => call.id === item.call_id)) {
          pending.calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
        }
      }
      return Promise.resolve();
    }
    if (this.completed.has(event.response.id)) return Promise.resolve();
    if (this.completed.size >= 100)
      return Promise.reject(new Error("Backend response limit reached"));
    this.completed.add(event.response.id);
    const usage = event.response.usage;
    if (usage)
      this.options.recordUsage(event.response.id, {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      });
    const pending = this.pending.get(delegation);
    this.pending.delete(delegation);
    if (event.type !== "response.completed")
      return Promise.reject(new Error("Backend response failed"));
    if (!pending || pending.id !== event.response.id || !pending.calls.length)
      return Promise.resolve();
    this.chain = this.chain.then(async () => {
      let submitted = false;
      for (const call of pending.calls) {
        if (this.stopped || this.executed.has(call.id)) continue;
        this.executed.add(call.id);
        const result = await this.options.execute(call);
        if (this.stopped) return;
        this.options.send({
          type: "response.item.create",
          item: {
            type: "function_call_output",
            call_id: call.id,
            output: JSON.stringify(result.output),
          },
        });
        submitted = true;
        if (result.control) {
          this.options.control(result.control);
          return;
        }
      }
      if (submitted && !this.stopped) this.options.send({ type: "response.create" });
    });
    return this.chain;
  }
}
