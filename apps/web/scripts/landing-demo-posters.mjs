import { chromium } from "playwright-core";
import sharp from "sharp";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const browserPath = process.argv.includes("--browser")
  ? option("--browser")
  : process.env.CHROME_PATH;
if (!browserPath) throw new Error("Pass --browser /path/to/chromium or set CHROME_PATH.");
const output = resolve("public/demo-posters");

// Production React reports a hydration mismatch without saying which text differs. The texts of
// the hydrated page that the server HTML lacks, and the reverse, point to it.
const describeTextMismatch = async (page) => {
  const html = await (await page.request.get(page.url())).text();
  const serverText = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "")
    // React separates adjacent text values with comments: `{name}:{level}` is one text on screen.
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<[^>]+>/)
    .map((text) =>
      text
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .trim(),
    )
    .filter(Boolean);
  const clientText = (await page.locator("body").innerText())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // Case aside: CSS may upper-case what the HTML writes in lower case.
  const server = serverText.join("\n").toLowerCase();
  const client = clientText.join("\n").toLowerCase();
  const list = (lines) => [...new Set(lines)].slice(0, 20).map((line) => `  ${JSON.stringify(line)}`);
  return [
    "Browser text missing from the server HTML:",
    ...list(clientText.filter((line) => !server.includes(line.toLowerCase()))),
    "Server text missing from the browser:",
    ...list(serverText.filter((text) => !client.includes(text.toLowerCase()))),
  ].join("\n");
};
let server;
let browser;

try {
  let baseUrl = process.argv.includes("--base-url") ? option("--base-url") : undefined;
  if (process.argv.includes("--start")) {
    const socket = createServer();
    await new Promise((accept) => socket.listen(0, "127.0.0.1", accept));
    const port = socket.address().port;
    await new Promise((accept) => socket.close(accept));
    baseUrl = `http://127.0.0.1:${port}`;
    const standalone = resolve(".next/standalone/apps/web");
    await cp("public", resolve(standalone, "public"), { recursive: true });
    await cp(".next/static", resolve(standalone, ".next/static"), { recursive: true });
    // The capture server has no credentials or database URL. Demo data are fixtures.
    server = spawn(process.execPath, [resolve(standalone, "server.js")], {
      cwd: standalone,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        SKIP_ENV_VALIDATION: "true",
        AUTH_SECRET: "demo-capture-build-only-not-a-deployment-secret",
        AUTH_URL: baseUrl,
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        NEXT_PUBLIC_APP_URL: baseUrl,
        NEXT_PUBLIC_APP_DOMAIN: `127.0.0.1:${port}`,
        LOUEZ_MODE: "platform",
      },
    });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null || server.signalCode !== null)
        throw new Error("Demo capture server exited.");
      try {
        const response = await fetch(`${baseUrl}/demos/landing/advisor?poster=1`, {
          signal: AbortSignal.timeout(3000),
        });
        await response.arrayBuffer();
        if (response.ok) break;
      } catch {
        /* Wait for the isolated server to listen. */
      }
      if (attempt === 119) throw new Error("Demo capture server did not become ready.");
      await new Promise((accept) => setTimeout(accept, 500));
    }
  }
  if (!baseUrl || !/^https?:\/\//.test(baseUrl))
    throw new Error("Use --start or --base-url http(s)://host.");
  browser = await chromium.launch({
    executablePath: browserPath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  await mkdir(output, { recursive: true });
  const sizes = {};
  // One poster per scene and language: `<scene>.<locale>.webp`, plus `<scene>.webp` in
  // French for landings that predate the language parameter.
  const locales = ["fr", "en", "it", "nl", "pt", "de", "es", "pl"];
  // Every scene of `DEMO_SCENES` except the three-step journey, which opens on the storefront.
  const scenes = [
    "storefront",
    "planning",
    "reservation",
    "advisor",
    "planning-timeline",
    "reservations-paid",
    "reservation-deposit",
    "api-key-permissions",
    "analytics-sales",
    "analytics-fleet",
    "products-list",
    "products-filter",
    "product-availability",
    "pricing-ladder",
    "pricing-seasons-promos",
    "inspection-wizard",
    "inspection-items",
    "inspection-compare",
    "inspection-settings",
    "multi-store",
    "multi-store-chart",
    "team-invite",
    "delivery-settings",
    "delivery-simulator",
    "delivery-calendar",
    "customer-detail",
    "customers-search",
    "notification-settings",
    "customer-reminders",
    "booking-confirmation",
    "storefront-product",
    "storefront-pricing",
    "storefront-quick-add",
    "storefront-extras",
    "storefront-home",
    "portal-access",
    "portal-login",
    "portal-quote",
    "portal-account",
    "checkout-payment",
    "checkout-delivery",
    "contract-document",
    "contract-content",
    "contract-trace",
  ];
  // Scenes whose demo config says `format: "phone"`: a phone page, 390 × 844.
  const phoneScenes = ["inspection-wizard", "inspection-items", "portal-access"];
  // `--scenes a,b` redraws only these, and keeps the recorded sizes of the others.
  const selected = process.argv.includes("--scenes") ? option("--scenes").split(",") : scenes;
  const unknown = selected.filter((scene) => !scenes.includes(scene));
  if (unknown.length) throw new Error(`Unknown demo scenes: ${unknown.join(", ")}`);
  if (selected.length < scenes.length) {
    const manifest = await readFile(resolve(output, "manifest.json"), "utf8").catch(() => "{}");
    Object.assign(sizes, JSON.parse(manifest).bytes);
  }
  const captures = locales.flatMap((locale) => selected.map((scene) => ({ scene, locale })));
  // Every capture runs, then all failures are reported together: one build shows them all.
  const failures = [];
  for (const { scene, locale } of captures) {
    const phone = phoneScenes.includes(scene);
    const page = await context.newPage();
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${baseUrl}/demos/landing/${scene}?poster=1&locale=${locale}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-demo-ready="true"]').waitFor();
    await page.evaluate(async () => {
      // An image counts as visible when its centre is on screen: a lazy one that only grazes the
      // bottom edge, clipped by a scrolling parent, never loads and must not be waited for.
      const images = Array.from(document.images).filter((image) => {
        const rect = image.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return (
          rect.width > 0 && rect.height > 0 && x > 0 && x < innerWidth && y > 0 && y < innerHeight
        );
      });
      let timeout;
      try {
        await Promise.race([
          Promise.all([document.fonts.ready, ...images.map((image) => image.decode())]),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Timed out waiting for visible demo assets")),
              30_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    });
    if (errors.length) {
      const hydration = errors.some((error) => /react\.dev\/errors\/(418|425)\b/.test(error));
      const details = hydration ? `\n${await describeTextMismatch(page)}` : "";
      failures.push(`${scene} (${locale}): ${errors.join("\n")}${details}`);
      await page.close();
      continue;
    }
    const png = await page.screenshot({
      animations: "disabled",
      clip: phone
        ? { x: 0, y: 0, width: 390, height: 844 }
        : { x: 0, y: 0, width: 1440, height: scene === "advisor" ? 570 : 1000 },
    });
    const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
    await writeFile(resolve(output, `${scene}.${locale}.webp`), webp);
    if (locale === "fr") await writeFile(resolve(output, `${scene}.webp`), webp);
    sizes[`${scene}.${locale}`] = webp.length;
    await page.close();
  }
  if (failures.length)
    throw new Error(`${failures.length} demo poster(s) failed:\n\n${failures.join("\n\n")}`);
  await writeFile(
    resolve(output, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), bytes: sizes }, null, 2) + "\n",
  );
  console.log("Demo posters generated:", sizes);
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((accept) => server.once("exit", accept));
    server.kill("SIGTERM");
    const force = setTimeout(() => server.kill("SIGKILL"), 5000);
    await stopped;
    clearTimeout(force);
  }
}
