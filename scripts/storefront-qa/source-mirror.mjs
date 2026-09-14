import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { transformSource } from "./source-transforms.mjs";

export function isSourceFile(file) {
  return (
    file &&
    !path.isAbsolute(file) &&
    !file
      .split("/")
      .some(
        (part) =>
          [
            "..",
            ".git",
            "node_modules",
            ".next",
            ".turbo",
            ".agent-docs",
            ".playwright-cli",
            "output",
          ].includes(part) ||
          part.startsWith(".env") ||
          part.startsWith(".localify") ||
          part.endsWith(".tsbuildinfo"),
      ) &&
    !file.startsWith("apps/web/public/qa/")
  );
}

export function createSourceMirror({
  sourceRoot,
  snapshotDir,
  state,
  onChange = () => {},
  onError = console.error,
}) {
  const fingerprints = new Map();
  let timer;
  const sync = () => {
    const files = new Set(
      execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        cwd: sourceRoot,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      })
        .split("\0")
        .filter(isSourceFile),
    );
    const changed = [];
    for (const file of new Set([...files, ...fingerprints.keys()])) {
      const source = path.join(sourceRoot, file);
      const target = path.join(snapshotDir, file);
      try {
        let stat;
        try {
          stat = lstatSync(source, { bigint: true });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (!files.has(file) || !stat?.isFile()) {
          if (fingerprints.delete(file)) {
            rmSync(target, { force: true });
            changed.push(file);
          }
          continue;
        }
        const fingerprint = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
        if (fingerprints.get(file) === fingerprint) continue;
        const content = transformSource(file, readFileSync(source), state);
        if (!existsSync(target) || !readFileSync(target).equals(content)) {
          mkdirSync(path.dirname(target), { recursive: true });
          const temporary = `${target}.qa-sync-${process.pid}`;
          try {
            writeFileSync(temporary, content, { mode: Number(stat.mode) });
            renameSync(temporary, target);
          } finally {
            rmSync(temporary, { force: true });
          }
          changed.push(file);
        }
        fingerprints.set(file, fingerprint);
      } catch (error) {
        onError(new Error(`Source sync failed for ${file}: ${error.message}`));
      }
    }
    if (changed.length) onChange(changed);
    return changed;
  };
  return {
    sync,
    start() {
      sync();
      timer = setInterval(() => {
        try {
          sync();
        } catch (error) {
          onError(error);
        }
      }, 750);
    },
    close() {
      clearInterval(timer);
    },
  };
}
