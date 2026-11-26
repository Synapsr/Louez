import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { pathToFileURL } from "node:url";

type ByteRange = { start: number; end: number };

/**
 * Storage as a map of keys to their bytes, or to the error reading them
 * throws, for the modules that read images through `@/lib/storage/files`;
 * with the reads it served and the warnings `@/lib/evlog` received. Call it
 * before the module under test loads. The stubs are resolved by a hook, as
 * `mock.module` would leave the modules' `server-only` import unresolved.
 */
export function useStoredImages() {
  const stored = new Map<string, Buffer | Error>();
  const reads: Array<{ key: string; range?: ByteRange }> = [];
  const warnings: string[] = [];

  const stubs = {
    "@/lib/storage/files": {
      getImageFiles: () => ({
        download: async (key: string, options?: { range?: ByteRange }) => {
          reads.push({ key, range: options?.range });
          const value = stored.get(key);
          if (!value) throw new Error(`${key} not found`);
          if (value instanceof Error) throw value;
          // As S3 answers a range: at most its bytes.
          const bytes = options?.range ? value.subarray(0, options.range.end + 1) : value;
          return { arrayBuffer: async () => new Uint8Array(bytes).buffer };
        },
      }),
    },
    "@/lib/evlog": {
      log: { warn: (...parts: unknown[]) => warnings.push(parts.join(" ")) },
    },
  };
  Reflect.set(globalThis, "__louezStoredImageStubs", stubs);

  const directory = mkdtempSync(join(tmpdir(), "louez-stored-images-"));
  after(() => rmSync(directory, { recursive: true }));
  const files = new Map(
    Object.keys(stubs).map((specifier, index) => {
      const path = join(directory, `stub-${index}.cjs`);
      writeFileSync(
        path,
        `module.exports = globalThis.__louezStoredImageStubs[${JSON.stringify(specifier)}];`,
      );
      return [specifier, pathToFileURL(path).href];
    }),
  );
  Reflect.get(
    nodeModule,
    "registerHooks",
  )({
    resolve(
      specifier: string,
      context: unknown,
      next: (specifier: string, context: unknown) => unknown,
    ) {
      if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
      const url = files.get(specifier);
      return url ? { url, shortCircuit: true } : next(specifier, context);
    },
  });

  return { stored, reads, warnings };
}
