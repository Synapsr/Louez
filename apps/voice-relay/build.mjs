import { build } from "esbuild";

// Bundle the versions already installed from pnpm-lock.yaml. A deploy-time
// install can resolve optional peers again and silently change provider code.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // ws catches missing optional native accelerators and uses its JS fallback.
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "info",
});
