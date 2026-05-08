import { readFile as fsReadFile } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { basename, dirname } from "node:path";
import type { Runtime, Unwatch } from "../types.js";

/**
 * Node.js runtime adapter. Uses node:fs/promises for file reads and
 * process.env for environment access. Selected by detect.ts when no
 * `Deno` or `Bun` global is present.
 */
export const nodeRuntime: Runtime = {
  async readFile(path: string): Promise<string> {
    return fsReadFile(path, "utf8");
  },
  readEnv(key: string): string | undefined {
    return process.env[key];
  },
  listEnv(prefix: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (k.startsWith(prefix)) out[k] = v;
    }
    return out;
  },
  watchPath(path: string, handler: () => void): Unwatch {
    // Low-level primitive: watch the parent directory (so atomic-rename
    // doesn't lose the watcher) but filter to events for the target file.
    // Debounce, symlink resolution, and onError wiring belong to task
    // 14a's watcher built on top of this primitive.
    const target = basename(path);
    const watcher = fsWatch(
      dirname(path),
      { persistent: false },
      (_event, filename) => {
        // filename is null on some platforms — fall through to fire,
        // letting the higher-level watcher decide. When provided, only
        // forward events that match the target basename.
        if (filename === null || filename === target) {
          handler();
        }
      },
    );
    // Attach an error listener so EACCES/ENOSPC etc. don't surface as
    // unhandled events. Task 14a will wire this to a user onError channel;
    // for now, swallow rather than crash.
    watcher.on("error", () => {
      /* deliberate: forwarded by task 14a wrapper */
    });
    return () => watcher.close();
  },
};
