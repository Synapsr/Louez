import { randomBytes } from "node:crypto";
import type { Transcript } from "@louez/voice/protocol";

export class Transcripts {
  private segments = new Map<Transcript["role"], Transcript & { endMs: number }>();
  private dirty = new Map<string, Transcript>();
  private seen = new Set<string>();

  append(eventId: string, role: Transcript["role"], delta: string, startMs: number, endMs: number) {
    if (this.seen.has(eventId)) return;
    if (this.seen.size >= 20_000) throw new Error("Transcript event limit reached");
    this.seen.add(eventId);
    let segment = this.segments.get(role);
    if (!segment || startMs - segment.endMs > 1200 || segment.text.length + delta.length > 8000) {
      segment = {
        id: randomBytes(16).toString("base64url").slice(0, 21),
        role,
        text: "",
        startMs,
        endMs,
      };
      this.segments.set(role, segment);
    }
    // Fragments include whitespace. Never trim, deduplicate words or guess turns.
    segment.text += delta;
    segment.endMs = Math.max(segment.endMs, endMs);
    this.dirty.set(segment.id, {
      id: segment.id,
      role,
      text: segment.text,
      startMs: segment.startMs,
    });
    if (this.dirty.size > 50) throw new Error("Transcript persistence fell behind");
  }
  drain(): Transcript[] {
    const result = [...this.dirty.values()];
    this.dirty.clear();
    return result;
  }
}
