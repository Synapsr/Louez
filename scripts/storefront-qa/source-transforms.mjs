import { domain } from "./runtime.mjs";

const transports = {
  "packages/api/src/services/address.ts": [
    ["https://places.googleapis.com", "google"],
    ["https://nominatim.openstreetmap.org", "nominatim"],
  ],
  "packages/api/src/services/distance.ts": [["https://routes.googleapis.com", "google"]],
  "apps/web/lib/google-places/index.ts": [["https://maps.googleapis.com", "google"]],
};
export const patchedFiles = [
  "apps/web/package.json",
  "apps/web/next.config.ts",
  "apps/web/lib/stripe/client.ts",
  ...Object.keys(transports),
];

// Transform before writing so a running app never sees the original provider endpoints.
export function transformSource(file, bytes, state) {
  if (!patchedFiles.includes(file)) return bytes;
  let source = bytes.toString("utf8");
  const replace = (from, to) => {
    if (!source.includes(from)) throw new Error(`QA transport/configuration changed: ${file}`);
    source = source.replaceAll(from, to);
  };
  if (file === "apps/web/package.json") {
    const manifest = JSON.parse(source);
    delete manifest.scripts?.["dev-localify"];
    source = `${JSON.stringify(manifest, null, 2)}\n`;
  } else if (file === "apps/web/next.config.ts") {
    replace("allowedDevOrigins: [", `allowedDevOrigins: [\n    '${domain}', '*.${domain}',`);
  } else if (file === "apps/web/lib/stripe/client.ts") {
    replace(
      "typescript: true,",
      `typescript: true,\n      host: '127.0.0.1', port: ${state.fixturePort}, protocol: 'http', maxNetworkRetries: 0,`,
    );
  } else {
    for (const [from, endpoint] of transports[file]) {
      replace(from, `http://127.0.0.1:${state.fixturePort}/${endpoint}`);
    }
  }
  return Buffer.from(source);
}
