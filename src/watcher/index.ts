import { realpath } from "node:fs/promises";
import { getRuntime } from "../runtime/detect.js";
import type { Runtime, Unwatch } from "../types.js";

export interface WatcherOptions {
  /** Debounce window in ms. Default: 75. Coalesces burst events into one call. */
  readonly debounceMs?: number;
  /** Optional. If provided, called when the underlying watcher errors (EACCES, ENOSPC, etc.). */
  readonly onError?: (err: unknown) => void;
  /** Optional. Override the runtime (for tests / Workers). Default: detected runtime. */
  readonly runtime?: Runtime;
  /** Optional. Resolve symlinks before watching. Default: true. */
  readonly resolveSymlinks?: boolean;
}

/**
 * Watch a file for changes with debouncing and symlink resolution.
 * Returns an Unwatch function. Calling Unwatch is idempotent and safe.
 *
 * The handler is called with NO arguments after the file changes and the
 * debounce window expires. The handler is responsible for re-reading.
 *
 * Built on top of `runtime.watchPath`, which already does parent-directory
 * watching (so atomic-rename via `mv tmp.yaml config.yaml` doesn't lose the
 * watcher). This wrapper layers on:
 *   - symlink resolution at watch start (so the actual target is observed),
 *   - debounce (coalesce burst events from editor saves),
 *   - error forwarding to onError (avoid throwing into the user's face),
 *   - idempotent unwatch (safe to call multiple times; post-unwatch firings
 *     are dropped).
 *
 * If the runtime has no `watchPath` (Cloudflare Workers etc.), `watchFile`
 * throws synchronously with a clear error.
 */
export async function watchFile(
  path: string,
  handler: () => void,
  options: WatcherOptions = {},
): Promise<Unwatch> {
  const debounceMs = options.debounceMs ?? 75;
  const runtime = await getRuntime(options.runtime);
  if (!runtime.watchPath) {
    throw new Error(
      "confetti: runtime has no watchPath; file watching is not available in this environment",
    );
  }

  let watchedPath = path;
  if (options.resolveSymlinks !== false) {
    try {
      watchedPath = await realpath(path);
    } catch {
      // File may not exist yet, or realpath may be unavailable on this
      // runtime. Fall back to the original path; parent-dir watching will
      // still pick up appearances.
    }
  }

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let innerUnwatch: Unwatch;
  try {
    innerUnwatch = runtime.watchPath(watchedPath, () => {
      if (disposed) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed) return;
        try {
          handler();
        } catch (err) {
          options.onError?.(err);
        }
      }, debounceMs);
    });
  } catch (err) {
    options.onError?.(err);
    throw err;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    try {
      const result = innerUnwatch();
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => options.onError?.(err));
      }
    } catch (err) {
      options.onError?.(err);
    }
  };
}
