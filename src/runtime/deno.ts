import type { Runtime, Unwatch } from "../types.js";

/**
 * Deno runtime adapter. Selected by detect.ts when `globalThis.Deno`
 * is present. Loaded via dynamic import so Node/Bun bundles never
 * touch the `Deno` reference and remain tree-shakable.
 */

// Minimal Deno API surface we use. Avoids needing @deno/types as a devDep
// just for typechecking. Real shape verified at runtime by the detect.ts
// guard before this module ever loads.
declare const Deno: {
  readTextFile(path: string): Promise<string>;
  env: {
    get(key: string): string | undefined;
    toObject(): Record<string, string>;
  };
  watchFs(
    paths: string | string[],
    options?: { recursive?: boolean },
  ): AsyncIterable<{ kind: string; paths: string[] }> & { close(): void };
};

export const denoRuntime: Runtime = {
  async readFile(path: string): Promise<string> {
    return Deno.readTextFile(path);
  },
  readEnv(key: string): string | undefined {
    return Deno.env.get(key);
  },
  listEnv(prefix: string): Record<string, string> {
    const all = Deno.env.toObject();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(prefix)) out[k] = v;
    }
    return out;
  },
  watchPath(path: string, handler: () => void): Unwatch {
    // Deno's watchFs is async-iterable. We run the consumer loop and
    // close the iterator on Unwatch.
    let stopped = false;
    const watcher = Deno.watchFs(path, { recursive: false });
    void (async () => {
      try {
        for await (const _evt of watcher) {
          if (stopped) break;
          handler();
        }
      } catch {
        // Watcher closed — expected.
      }
    })();
    return () => {
      stopped = true;
      watcher.close();
    };
  },
};
