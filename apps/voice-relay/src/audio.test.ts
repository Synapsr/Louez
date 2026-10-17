import assert from "node:assert/strict";
import { test } from "node:test";
import { InterruptionDetector, mulawRms, pcmWav } from "./audio.js";
import { Transcripts } from "./transcripts.js";

test("mu-law silence does not interrupt; sustained speech clears once per utterance", () => {
  const detector = new InterruptionDetector(900);
  const silence = Buffer.alloc(160, 255);
  const voice = Buffer.alloc(160, 0);
  assert.equal(mulawRms(silence), 0);
  for (let i = 0; i < 100; i++) assert.equal(detector.push(silence), false);
  for (let i = 0; i < 5; i++) assert.equal(detector.push(voice), false);
  assert.equal(detector.push(voice), true);
  for (let i = 0; i < 10; i++) assert.equal(detector.push(voice), false);
  for (let i = 0; i < 20; i++) detector.push(silence);
  for (let i = 0; i < 5; i++) detector.push(voice);
  assert.equal(detector.push(voice), true);
});
test("preview WAV has valid mono PCM16 framing", () => {
  const bytes = Buffer.from([1, 0, 255, 127]);
  const wav = pcmWav(bytes);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), bytes.length);
  assert.deepEqual(wav.subarray(44), bytes);
});
test("transcripts preserve whitespace and repeated words; retries retain stable segment IDs", () => {
  const transcript = new Transcripts();
  transcript.append("a", "user", "oui", 0, 100);
  const first = transcript.drain()[0];
  assert.ok(first);
  transcript.append("b", "user", " oui", 100, 200);
  transcript.append("b", "user", " oui", 100, 200);
  transcript.append("c", "assistant", "Bonjour", 100, 200);
  const next = transcript.drain();
  assert.equal(next[0]?.id, first.id);
  assert.equal(next[0]?.text, "oui oui");
  assert.equal(first.text, "oui"); // Earlier snapshots must not mutate.
  assert.equal(next[1]?.role, "assistant");
  transcript.append("d", "user", "merci", 2000, 2300);
  assert.notEqual(transcript.drain()[0]?.id, first.id);
});
