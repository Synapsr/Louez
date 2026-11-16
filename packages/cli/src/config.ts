/**
 * The key `louez auth login` saves, with the base URL it was checked
 * against: `config.json` in the user's config directory,
 * `$XDG_CONFIG_HOME/louez` or `~/.config/louez` (macOS too), or
 * `%APPDATA%\louez` on Windows.
 *
 * On POSIX systems the key lives only in a regular file readable by its
 * owner alone (0600), in a directory only its owner can enter (0700):
 * - the directory is created 0700; one that is a symbolic link, belongs to
 *   another user, or other users can write to is refused; one other users
 *   can only read or enter is tightened to 0700, with a warning;
 * - the file is never written in place: the new content goes to a temporary
 *   file created exclusively (0600) in the same directory, synced, then
 *   renamed over it, so a reader sees the old file or the new one, never a
 *   half-written one, and the old file never holds the new key; a target
 *   that is a symbolic link, not a regular file, or another user's is
 *   refused;
 * - reading refuses a symbolic link and a file of another user, and tightens
 *   a file other users can read to 0600, with a warning to revoke the key.
 * On Windows, file modes are best-effort: the checks of ownership and modes
 * are skipped, the exclusive temporary file and the rename are kept.
 */
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { errorCode, record, text } from "./json.js";
import { UsageError } from "./usage-error.js";

interface SavedConfig {
  apiKey?: string;
  /** The base URL the key was checked against: the key goes to its origin only. */
  apiUrl?: string;
}

const POSIX = process.platform !== "win32";

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

const ownedByAnother = (uid: number) =>
  POSIX && process.getuid !== undefined && uid !== process.getuid();

/**
 * Checks the directory, creating it 0700 when `create` and it is missing.
 * False when it is missing and not created. Warnings go to `warnings`.
 */
async function checkDir(dir: string, create: boolean, warnings: string[]): Promise<boolean> {
  let info = await lstat(dir).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (!info) {
    if (!create) return false;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // The mode asked at creation is reduced by the umask: set it exactly.
    if (POSIX) await chmod(dir, 0o700);
    info = await lstat(dir);
  }
  if (info.isSymbolicLink()) {
    throw new UsageError(
      `${dir} is a symbolic link: louez keeps its key only in a real directory. Remove the link.`,
    );
  }
  if (!info.isDirectory()) throw new UsageError(`${dir} is not a directory.`);
  if (!POSIX) return true;
  if (ownedByAnother(info.uid)) throw new UsageError(`${dir} belongs to another user.`);
  if (info.mode & 0o022) {
    throw new UsageError(
      `Other users can write to ${dir}: louez keeps no key there. Run \`chmod 700 ${dir}\`.`,
    );
  }
  if (info.mode & 0o077) {
    await chmod(dir, 0o700);
    warnings.push(`${dir} was open to other users; it is now 0700.`);
  }
  return true;
}

export interface ReadResult {
  config: SavedConfig;
  warnings: string[];
}

export async function readConfig(dir: string): Promise<ReadResult> {
  const warnings: string[] = [];
  if (!(await checkDir(dir, false, warnings))) return { config: {}, warnings };
  const file = configFile(dir);
  let handle;
  try {
    // O_NOFOLLOW: a symbolic link fails to open (ELOOP) instead of being read.
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { config: {}, warnings };
    if (code === "ELOOP") {
      throw new UsageError(
        `${file} is a symbolic link: louez reads its key only from a regular file.`,
      );
    }
    throw error;
  }
  let raw: string;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new UsageError(`${file} is not a regular file.`);
    if (ownedByAnother(info.uid)) throw new UsageError(`${file} belongs to another user.`);
    if (POSIX && info.mode & 0o077) {
      await handle.chmod(0o600);
      warnings.push(
        `${file} was readable by other users; it is now 0600. Anyone who read it has the key: revoke it in Louez and run \`louez auth login\` with a new one.`,
      );
    }
    raw = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError(`${file} is not valid JSON: fix it or remove it.`);
  }
  const config = record(parsed);
  const apiKey = text(config?.apiKey);
  const apiUrl = text(config?.apiUrl);
  return { config: { ...(apiKey ? { apiKey } : {}), ...(apiUrl ? { apiUrl } : {}) }, warnings };
}

/**
 * Replaces the file with `config`. `replace` moves the temporary file over
 * the target (`rename`; the tests pass one that fails).
 */
export async function writeConfig(
  dir: string,
  config: SavedConfig,
  replace: (from: string, to: string) => Promise<void> = rename,
): Promise<string[]> {
  const warnings: string[] = [];
  await checkDir(dir, true, warnings);
  const file = configFile(dir);
  const existing = await lstat(file).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (existing?.isSymbolicLink()) {
    throw new UsageError(
      `${file} is a symbolic link: louez writes its key only to a regular file. Remove the link.`,
    );
  }
  if (existing && !existing.isFile()) throw new UsageError(`${file} is not a regular file.`);
  if (existing && ownedByAnother(existing.uid)) {
    throw new UsageError(`${file} belongs to another user: louez replaces only a file of yours.`);
  }

  const temporary = join(dir, `.config.json.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      // The mode asked at creation is reduced by the umask: set it exactly.
      if (POSIX) await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replace(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return warnings;
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
