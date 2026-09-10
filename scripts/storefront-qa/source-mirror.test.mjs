import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSourceMirror } from "./source-mirror.mjs";
import { transformSource } from "./source-transforms.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "qa-mirror-"));
  const sourceRoot = path.join(root, "checkout");
  const snapshotDir = path.join(root, "snapshot");
  mkdirSync(sourceRoot);
  mkdirSync(snapshotDir);
  execFileSync("git", ["init", "--quiet", sourceRoot]);
  const errors = [];
  const mirror = createSourceMirror({
    sourceRoot,
    snapshotDir,
    state: { fixturePort: 12345 },
    onError: (error) => errors.push(error),
  });
  t.after(() => {
    mirror.close();
    rmSync(root, { recursive: true, force: true });
  });
  const write = (file, content, base = sourceRoot) => {
    mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    writeFileSync(path.join(base, file), content);
  };
  const read = (file) => readFileSync(path.join(snapshotDir, file), "utf8");
  return { sourceRoot, snapshotDir, mirror, errors, write, read };
}

test("mirrors edits, additions, renames and deletions, including shared packages", (t) => {
  const f = fixture(t);
  f.write("apps/web/component.tsx", "first");
  execFileSync("git", ["add", "."], { cwd: f.sourceRoot });
  f.mirror.sync();
  f.write("apps/web/component.tsx", "second");
  f.write("packages/ui/component.tsx", "shared");
  assert.equal(f.mirror.sync().length, 2);
  assert.equal(f.read("apps/web/component.tsx"), "second");
  assert.equal(f.read("packages/ui/component.tsx"), "shared");
  renameSync(
    path.join(f.sourceRoot, "packages/ui/component.tsx"),
    path.join(f.sourceRoot, "packages/ui/renamed.tsx"),
  );
  rmSync(path.join(f.sourceRoot, "apps/web/component.tsx"));
  f.mirror.sync();
  assert.equal(existsSync(path.join(f.snapshotDir, "apps/web/component.tsx")), false);
  assert.equal(existsSync(path.join(f.snapshotDir, "packages/ui/component.tsx")), false);
  assert.equal(f.read("packages/ui/renamed.tsx"), "shared");
  assert.deepEqual(f.errors, []);
});

test("does not rewrite unchanged files and copies binary assets intact", (t) => {
  const f = fixture(t);
  const bytes = Buffer.from([0, 255, 128, 42]);
  f.write("apps/web/public/example.png", bytes);
  f.mirror.sync();
  const target = path.join(f.snapshotDir, "apps/web/public/example.png");
  const before = statSync(target).mtimeMs;
  assert.deepEqual(f.mirror.sync(), []);
  assert.equal(statSync(target).mtimeMs, before);
  assert.deepEqual(readFileSync(target), bytes);
});

test("excludes env, generated files and symlinks, preserving snapshot-only artifacts", (t) => {
  const f = fixture(t);
  for (const file of [
    ".env",
    "apps/web/.env.local",
    "node_modules/test.js",
    ".next/cache",
    ".agent-docs/state.json",
    "apps/web/public/qa/index.html",
    "output/test.png",
    ".localify.json",
  ]) {
    f.write(file, "must not copy");
  }
  // Tracked env files must remain excluded even if Git lists them.
  execFileSync("git", ["add", "--force", "."], { cwd: f.sourceRoot });
  f.write("apps/web/public/qa/index.html", "report", f.snapshotDir);
  f.write("apps/web/.next/cache", "next cache", f.snapshotDir);
  symlinkSync(path.join(f.sourceRoot, ".env"), path.join(f.sourceRoot, "linked.ts"));
  f.mirror.sync();
  assert.equal(existsSync(path.join(f.snapshotDir, ".env")), false);
  assert.equal(existsSync(path.join(f.snapshotDir, "linked.ts")), false);
  assert.equal(existsSync(path.join(f.snapshotDir, "node_modules/test.js")), false);
  assert.equal(f.read("apps/web/public/qa/index.html"), "report");
  assert.equal(f.read("apps/web/.next/cache"), "next cache");
});

test("reapplies provider transforms on every save and retains safe copy on invalid source", (t) => {
  const f = fixture(t);
  const file = "apps/web/lib/stripe/client.ts";
  f.write(file, "const options = { typescript: true, }; // first");
  f.mirror.sync();
  assert.match(f.read(file), /host: '127.0.0.1', port: 12345/);
  f.write(file, "const options = { typescript: true, }; // edited");
  f.mirror.sync();
  const safe = f.read(file);
  assert.match(safe, /edited/);
  assert.match(safe, /protocol: 'http'/);
  f.write(file, "const options = {}; // anchor gone");
  f.mirror.sync();
  assert.equal(f.read(file), safe);
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0].message, /QA transport\/configuration changed/);
  f.write(file, "const options = { typescript: true, }; // repaired");
  f.mirror.sync();
  assert.match(f.read(file), /repaired/);
});

test("preserves QA origins, launch script and Google transport patches", () => {
  const transform = (file, value) =>
    transformSource(file, Buffer.from(value), { fixturePort: 12345 }).toString();
  assert.match(
    transform("apps/web/next.config.ts", "allowedDevOrigins: ["),
    /\*\.louez-qa\.localify/,
  );
  assert.deepEqual(
    JSON.parse(
      transform(
        "apps/web/package.json",
        '{"scripts":{"dev-localify":"localify dev","dev":"next dev"}}',
      ),
    ).scripts,
    { dev: "next dev" },
  );
  assert.equal(
    transform(
      "packages/api/src/services/address.ts",
      "https://places.googleapis.com https://nominatim.openstreetmap.org",
    ),
    "http://127.0.0.1:12345/google http://127.0.0.1:12345/nominatim",
  );
  assert.equal(
    transform("packages/api/src/services/distance.ts", "https://routes.googleapis.com"),
    "http://127.0.0.1:12345/google",
  );
  assert.equal(
    transform("apps/web/lib/google-places/index.ts", "https://maps.googleapis.com"),
    "http://127.0.0.1:12345/google",
  );
});
