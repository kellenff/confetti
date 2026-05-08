import { readFile as fsReadFile } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { dirname } from "node:path";
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
    // Low-level primitive only: watch the parent directory and forward
    // any event. Higher-level concerns (debounce, atomic-rename detection,
    // symlink resolution) belong to task 14a's watcher.
    const watcher = fsWatch(dirname(path), { persistent: false }, () => {
      handler();
    });
    return () => watcher.close();
  },
};
