import { readFile as fsReadFile } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { basename, dirname } from "node:path";
import type { Runtime, Unwatch } from "../types.js";

/**
 * Bun runtime adapter. Bun's node-compat layer makes node:fs and
 * process.env work natively, so this mirrors the Node adapter. We keep
 * a separate module so future Bun-specific optimisations (Bun.file,
 * Bun.YAML.parse for source-yaml, etc.) have a home — and so the
 * detect.ts dispatch reads symmetrically.
 */
export const bunRuntime: Runtime = {
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
    const target = basename(path);
    const watcher = fsWatch(
      dirname(path),
      { persistent: false },
      (_event, filename) => {
        if (filename === null || filename === target) {
          handler();
        }
      },
    );
    watcher.on("error", () => {
      /* deliberate: forwarded by task 14a wrapper */
    });
    return () => watcher.close();
  },
};
