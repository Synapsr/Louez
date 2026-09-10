import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  appEnv,
  cleanEnv,
  domain,
  readState,
  run,
  snapshotDir,
  sourceRoot,
  stateDir,
} from "./runtime.mjs";

import { syncSources } from "./sync.mjs";

const command = process.argv[2] || "help";
const marker = path.join(stateDir, "state.json");
const composeFile = path.join(sourceRoot, "docker/compose.storefront-qa.yml");
function compose(state, args, capture = false) {
  const pluginAvailable =
    spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
  return run(
    pluginAvailable ? "docker" : "docker-compose",
    [
      ...(pluginAvailable ? ["compose"] : []),
      "--project-name",
      state.project,
      "--env-file",
      "/dev/null",
      "-f",
      composeFile,
      ...args,
    ],
    {
      env: {
        ...cleanEnv(),
        DOCKER_CONTEXT: state.dockerContext,
        QA_DB_PASSWORD: state.dbPassword,
        QA_DB_ROOT_PASSWORD: state.dbRootPassword,
        QA_STORAGE_PASSWORD: state.storagePassword,
      },
      ...(capture ? { stdio: "pipe" } : {}),
    },
  );
}
function persist(state) {
  writeFileSync(marker, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port available");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}
function seed(state) {
  run("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
    cwd: path.join(snapshotDir, "packages/db"),
    env: appEnv(state),
  });
  run("pnpm", ["exec", "tsx", "scripts/storefront-qa/seed.ts", stateDir], {
    cwd: path.join(snapshotDir, "apps/web"),
    env: appEnv(state),
  });
  run("pnpm", ["exec", "tsx", "scripts/storefront-qa/refresh-report.ts", stateDir], {
    cwd: path.join(snapshotDir, "apps/web"),
    env: cleanEnv(),
  });
}

try {
  if (command === "setup") {
    if (existsSync(path.join(stateDir, "running.json")))
      throw new Error("Stop qa:storefront dev before setup.");
    mkdirSync(stateDir, { recursive: true });
    const state = existsSync(marker)
      ? readState()
      : {
          kind: "louez-storefront-qa-v1",
          sourceRoot,
          project: "louez-storefront-qa",
          dockerContext: process.env.QA_DOCKER_CONTEXT || "colima-louez-storefront-qa",
          dbPassword: randomBytes(24).toString("hex"),
          dbRootPassword: randomBytes(24).toString("hex"),
          storagePassword: randomBytes(24).toString("hex"),
          authSecret: randomBytes(32).toString("hex"),
          encryptionKey: randomBytes(32).toString("hex"),
          fixturePort: await freePort(),
        };
    persist(state);
    compose(state, ["up", "-d", "--wait"]);
    for (const [key, service, port] of [
      ["dbPort", "db", 3306],
      ["smtpPort", "mail", 1025],
      ["mailPort", "mail", 8025],
      ["storagePort", "storage", 9000],
    ]) {
      state[key] = Number(
        compose(state, ["port", service, String(port)], true)
          .split(":")
          .at(-1),
      );
    }
    persist(state);
    syncSources(state);
    const localifyOptions = { cwd: path.join(snapshotDir, "apps/web"), env: cleanEnv() };
    if (!existsSync(path.join(snapshotDir, "apps/web/.localify/project.json"))) {
      run(
        "localify",
        ["init-project", "louez-storefront-qa", "--domain", domain, "--yes"],
        localifyOptions,
      );
    } else {
      run("localify", ["project", "configure-dev"], localifyOptions);
    }
    const services = JSON.parse(run("localify", ["services", "list", "--json"], { stdio: "pipe" }));
    const service = services.find(
      (item) => item.projectId === "louez-storefront-qa" && item.primaryDomain === domain,
    );
    if (!service || !/^127\.0\.0\.1:\d+$/.test(service.target))
      throw new Error("QA Localify target missing");
    state.webTarget = service.target;
    state.service = service.id;
    persist(state);
    const registeredDomains = run("localify", ["list"], { stdio: "pipe" });
    if (!registeredDomains.includes(`*.${domain} (HTTPS)`)) {
      run(
        "localify",
        ["register", domain, "--wildcard", "--route", `/=${service.target}`],
        localifyOptions,
      );
    }
    seed(state);
    console.log(`Ready. Run pnpm qa:storefront dev. Mail: http://127.0.0.1:${state.mailPort}`);
  } else if (command === "sync") {
    const state = readState();
    syncSources(state);
    console.log("Sources refreshed. Existing reservations retained.");
  } else if (command === "reset") {
    if (existsSync(path.join(stateDir, "running.json")))
      throw new Error("Stop qa:storefront dev before reset.");
    const state = readState();
    // Execute inside the owned container. Never accept a DATABASE_URL from the shell or .env files.
    compose(state, [
      "exec",
      "-T",
      "db",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE IF EXISTS louez_storefront_qa; CREATE DATABASE louez_storefront_qa; GRANT ALL ON louez_storefront_qa.* TO storefront_qa;"',
    ]);
    seed(state);
  } else if (command === "dev") {
    run("node", ["scripts/storefront-qa/dev.mjs"]);
  } else if (command === "check") {
    run("node", ["scripts/storefront-qa/check.mjs"]);
  } else if (command === "stop") {
    if (existsSync(path.join(stateDir, "running.json")))
      throw new Error("Use Ctrl+C in qa:storefront dev first.");
    compose(readState(), ["stop"]);
  } else if (command === "status") {
    const state = readState();
    compose(state, ["ps"]);
    console.log(
      `Sources: ${state.snapshotAt}\nRecette: https://${domain}/qa/index.html\nEmails: http://127.0.0.1:${state.mailPort}`,
    );
  } else {
    console.log(
      "pnpm qa:storefront <setup|dev|sync|reset|check|status|stop>\nDocumentation: docs/testing/storefront-qa.md",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
