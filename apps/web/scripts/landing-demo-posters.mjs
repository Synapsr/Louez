import { chromium } from "playwright-core";
import sharp from "sharp";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
const browserPath = process.argv.includes("--browser")
  ? option("--browser")
  : process.env.CHROME_PATH;
if (!browserPath) throw new Error("Pass --browser /path/to/chromium or set CHROME_PATH.");
const output = resolve("public/demo-posters");
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
  for (const scene of ["storefront", "planning", "reservation", "advisor"]) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${baseUrl}/demos/landing/${scene}?poster=1`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-demo-ready="true"]').waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images)
          .filter((image) => image.getBoundingClientRect().top < innerHeight)
          .map((image) => image.decode()),
      );
    });
    if (errors.length) throw new Error(`${scene}: ${errors.join("\n")}`);
    const png = await page.screenshot({
      animations: "disabled",
      clip: { x: 0, y: 0, width: 1440, height: scene === "advisor" ? 570 : 1000 },
    });
    const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
    await writeFile(resolve(output, `${scene}.webp`), webp);
    sizes[scene] = webp.length;
    await page.close();
  }
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
