import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { configFile, readConfig, writeConfig } from "./config.js";
import { removeTempDirs, tempDir } from "./testing/fake-api.js";
import { UsageError } from "./usage-error.js";

after(removeTempDirs);

const KEY = "lz_config_test_key";
const config = { apiKey: KEY, apiUrl: "https://app.louez.test/api/v1" };

/** A config directory that does not exist yet, inside a fresh temporary one. */
async function newDir(): Promise<string> {
  return join(await tempDir(), "louez");
}

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe("writing the key", () => {
  test("creates the directory 0700 and the file 0600, whatever the umask", async () => {
    // A umask that would leave the owner unable to write, and the file 0400.
    const dir = await newDir();
    const previous = process.umask(0o277);
    try {
      await writeConfig(dir, config);
      assert.equal(await mode(dir), 0o700);
      assert.equal(await mode(configFile(dir)), 0o600);
      assert.deepEqual(JSON.parse(await readFile(configFile(dir), "utf8")), config);
    } finally {
      process.umask(previous);
    }
  });

  test("replaces a file others could read with a new 0600 file: the old one never holds the key", async () => {
    const dir = await newDir();
    await mkdir(dir, { mode: 0o700 });
    await writeFile(configFile(dir), '{"apiUrl":"https://old.louez.test/api/v1"}');
    await chmod(configFile(dir), 0o644);
    // Whatever the old file becomes, it is read through this handle.
    const old = await open(configFile(dir), "r");
    try {
      await writeConfig(dir, config);
      assert.doesNotMatch(await old.readFile("utf8"), new RegExp(KEY));
      assert.equal((await old.stat()).mode & 0o777, 0o644);
    } finally {
      await old.close();
    }
    assert.equal(await mode(configFile(dir)), 0o600);
    assert.equal(JSON.parse(await readFile(configFile(dir), "utf8")).apiKey, KEY);
  });

  test("leaves the old file whole, and no temporary file, when the write is interrupted", async () => {
    const dir = await newDir();
    await writeConfig(dir, { apiKey: "lz_old_key", apiUrl: config.apiUrl });
    const before = await readFile(configFile(dir), "utf8");
    await assert.rejects(
      writeConfig(dir, config, async () => {
        throw new Error("interrupted");
      }),
      /interrupted/,
    );
    assert.equal(await readFile(configFile(dir), "utf8"), before);
    assert.deepEqual(await readdir(dir), ["config.json"]);
  });

  test("refuses a file that is a symbolic link, and leaves what it points to untouched", async () => {
    const dir = await newDir();
    await mkdir(dir, { mode: 0o700 });
    const elsewhere = join(await tempDir(), "elsewhere.json");
    await writeFile(elsewhere, "not yours\n");
    await symlink(elsewhere, configFile(dir));

    await assert.rejects(writeConfig(dir, config), (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /symbolic link/);
      return true;
    });
    assert.equal(await readFile(elsewhere, "utf8"), "not yours\n");
    assert.equal(await readlink(configFile(dir)), elsewhere);
    await assert.rejects(readConfig(dir), /symbolic link/);
  });

  test("refuses a target that is not a regular file", async () => {
    const dir = await newDir();
    await mkdir(configFile(dir), { recursive: true });
    await assert.rejects(writeConfig(dir, config), /not a regular file/);
  });

  test("refuses a directory that is a symbolic link, writing nothing", async () => {
    const real = await tempDir();
    await chmod(real, 0o700);
    const dir = join(await tempDir(), "louez");
    await symlink(real, dir);
    await assert.rejects(writeConfig(dir, config), /symbolic link/);
    await assert.rejects(readConfig(dir), /symbolic link/);
    assert.deepEqual(await readdir(real), []);
  });

  test("refuses a directory other users can write to, writing nothing", async () => {
    for (const loose of [0o777, 0o770, 0o702]) {
      const dir = await newDir();
      await mkdir(dir);
      await chmod(dir, loose);
      await assert.rejects(writeConfig(dir, config), /Other users can write/);
      await assert.rejects(readConfig(dir), /Other users can write/);
      assert.deepEqual(await readdir(dir), []);
    }
  });

  test("tightens a directory other users can only read to 0700, and says so", async () => {
    const dir = await newDir();
    await mkdir(dir);
    await chmod(dir, 0o755);
    const warnings = await writeConfig(dir, config);
    assert.equal(await mode(dir), 0o700);
    assert.match(warnings.join("\n"), /now 0700/);
  });
});

describe("reading the key", () => {
  test("tightens a file others can read to 0600, says so and says to revoke the key", async () => {
    const dir = await newDir();
    await writeConfig(dir, config);
    await chmod(configFile(dir), 0o644);
    const { config: read, warnings } = await readConfig(dir);
    assert.deepEqual(read, config);
    assert.equal(await mode(configFile(dir)), 0o600);
    assert.match(warnings.join("\n"), /readable by other users.*revoke it/s);
  });

  test("finds nothing, and creates nothing, where nothing was saved", async () => {
    const dir = await newDir();
    assert.deepEqual(await readConfig(dir), { config: {}, warnings: [] });
    await assert.rejects(lstat(dir));
  });
});
