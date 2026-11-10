/**
 * Source paths as error tracking shows them: relative to the repository, so
 * a frame names `apps/web/…` or `node_modules/…`, never the machine's
 * directories (a user's home, the container's layout).
 */

/** Where the repository's own paths start: an absolute path is cut back to the first. */
const SOURCE_ROOTS = /(?:^|\/)((?:apps|packages|node_modules|\.next|src)\/.*)$/;

/** A source path relative to the repository; a path outside it keeps only its file name. */
export function relativeSourcePath(path: string): string {
  const plain = path.replace(/^file:\/\//, "");
  if (!plain.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(plain)) return plain;
  const normalized = plain.replace(/\\/g, "/");
  const rooted = SOURCE_ROOTS.exec(normalized);
  if (rooted?.[1]) return rooted[1];
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/** A stack frame (`at fn (path:line:col)`) with its path made relative. Node's own frames stay. */
export function relativeFramePath(frame: string): string {
  return frame.replace(
    /(?<=\(|\bat )(?:file:\/\/)?(?:\/|[A-Za-z]:[\\/])[^\s():]*(?=:\d+(?::\d+)?\)?$|\)?$)/,
    (path) => relativeSourcePath(path),
  );
}
