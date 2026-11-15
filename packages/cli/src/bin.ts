#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { main } from "./cli.js";
import { defaultConfigDir } from "./config.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a line from the terminal without echoing it. */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stderr.write(prompt);
    let secret = "";
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const done = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(secret);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") return done();
        if (char === "\u0003") return done(new Error("Cancelled."));
        if (char === "\u007f" || char === "\b") secret = secret.slice(0, -1);
        else secret += char;
      }
    };
    input.on("data", onData);
  });
}

process.exitCode = await main({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  stdinIsTTY: process.stdin.isTTY === true,
  readStdin,
  readSecret,
  readFile: (path) => readFile(path, "utf8"),
  fetch: globalThis.fetch,
  sleep: (ms) => sleep(ms),
  now: () => Date.now(),
  configDir: defaultConfigDir(process.env, process.platform, homedir()),
  newIdempotencyKey: () => randomUUID(),
});
