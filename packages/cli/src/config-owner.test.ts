import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { after, mock, test } from "node:test";

import { removeTempDirs, tempDir } from "./testing/fake-api.js";

after(removeTempDirs);

// `config.json` reads as another user's; everything else is as it is. Two
// users cannot be had without root: the stat is what changes.
const actual = { ...fs };
mock.module("node:fs/promises", {
  namedExports: {
    ...actual,
    lstat: async (path: string) => {
      const info = await actual.lstat(path);
      if (!path.endsWith("config.json")) return info;
      return Object.assign(Object.create(Object.getPrototypeOf(info)), info, { uid: info.uid + 1 });
    },
  },
});
const { configFile, writeConfig } = await import("./config.js");

test("writing refuses to replace a config file that belongs to another user, and leaves it as it was", async () => {
  const dir = join(await tempDir(), "louez");
  await fs.mkdir(dir, { mode: 0o700 });
  await fs.writeFile(configFile(dir), '{"apiUrl":"https://app.louez.test/api/v1"}', {
    mode: 0o600,
  });
  await assert.rejects(
    writeConfig(dir, { apiKey: "lz_ab12_AbCdEfGhIjKlMnOpQrSt" }),
    /belongs to another user/,
  );
  assert.equal(
    await fs.readFile(configFile(dir), "utf8"),
    '{"apiUrl":"https://app.louez.test/api/v1"}',
  );
  assert.deepEqual(await fs.readdir(dir), ["config.json"]);
});
