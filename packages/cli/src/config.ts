/**
 * The key `louez auth login` saves: `config.json` in the user's config
 * directory, `$XDG_CONFIG_HOME/louez` or `~/.config/louez` (macOS too), or
 * `%APPDATA%\louez` on Windows; readable by its owner only (0600, in a 0700
 * directory).
 */
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { errorCode, record, text } from "./json.js";

interface SavedConfig {
  apiKey?: string;
  apiUrl?: string;
}

export function defaultConfigDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  home: string,
): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "louez");
  if (platform === "win32" && env.APPDATA) return join(env.APPDATA, "louez");
  return join(home, ".config", "louez");
}

export const configFile = (dir: string) => join(dir, "config.json");

export async function readConfig(dir: string): Promise<SavedConfig> {
  let raw: string;
  try {
    raw = await readFile(configFile(dir), "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${configFile(dir)} is not valid JSON: fix it or remove it.`);
  }
  const config = record(parsed);
  const apiKey = text(config?.apiKey);
  const apiUrl = text(config?.apiUrl);
  return { ...(apiKey ? { apiKey } : {}), ...(apiUrl ? { apiUrl } : {}) };
}

export async function writeConfig(dir: string, config: SavedConfig): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = configFile(dir);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // The mode applies only to a new file: tighten one that was already there.
  await chmod(file, 0o600);
}

/** Removes the file; true when there was one. */
export async function removeConfig(dir: string): Promise<boolean> {
  try {
    await rm(configFile(dir));
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}
