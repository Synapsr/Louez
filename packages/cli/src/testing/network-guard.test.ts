import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

import { startFakeApi, type FakeApi } from "./fake-api.js";

const GUARD = fileURLToPath(new URL("./network-guard.ts", import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));

const servers: FakeApi[] = [];
after(() => Promise.all(servers.map((server) => server.close())));

/** Runs `fetch(start)` in a child process with the guard preloaded, as the tests run. */
function fetchUnderGuard(start: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        GUARD,
        "--input-type=module",
        "-e",
        "await fetch(process.env.START).then((response) => response.text()).catch(() => {});",
      ],
      {
        cwd: PACKAGE_DIR,
        env: { ...process.env, START: start },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/** A loopback server that redirects every request to `location(port)`. */
async function redirecting(to: (outside: FakeApi) => string, outside: FakeApi): Promise<FakeApi> {
  const server = await startFakeApi((_, response) => {
    response.writeHead(302, { Location: to(outside) });
    response.end();
  });
  servers.push(server);
  return server;
}

describe("the network guard", () => {
  test("fails the run on a redirect from 127.0.0.1 to another host, before that host gets a request", async () => {
    // Stands for a host outside: reached by the name "localhost", which is not 127.0.0.1.
    const outside = await startFakeApi((_, response) => response.end("{}"));
    servers.push(outside);
    const start = await redirecting(
      (target) => `http://localhost:${new URL(target.url).port}/x`,
      outside,
    );

    const run = await fetchUnderGuard(`${start.url}/stores`);
    assert.notEqual(run.code, 0);
    assert.match(run.stderr, /network-guard: a test fetched http:\/\/localhost:\d+/);
    assert.equal(start.received.length, 1);
    assert.equal(outside.received.length, 0);
  });

  test("follows a redirect that stays on 127.0.0.1", async () => {
    const next = await startFakeApi((_, response) => response.end("{}"));
    servers.push(next);
    const start = await redirecting((target) => `${target.url}/x`, next);

    const run = await fetchUnderGuard(`${start.url}/stores`);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(next.received.length, 1);
  });
});
