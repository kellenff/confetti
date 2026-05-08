import type { Runtime } from "../types.js";

let cached: Runtime | undefined;

/**
 * Resolve the runtime adapter on first use. Lazy by design: top-level
 * `import 'node:fs'` would throw on Cloudflare Workers and other edge
 * runtimes that lack node:fs. By deferring the import, detection runs
 * before the throw site.
 *
 * Pass a `Runtime` to bypass detection entirely — useful for Workers,
 * embedded JS hosts, and tests with in-memory file systems.
 */
export async function getRuntime(override?: Runtime): Promise<Runtime> {
  if (override) return override;
  if (cached) return cached;
  if (typeof (globalThis as { Deno?: unknown }).Deno !== "undefined") {
    cached = (await import("./deno.js")).denoRuntime;
  } else if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    cached = (await import("./bun.js")).bunRuntime;
  } else {
    cached = (await import("./node.js")).nodeRuntime;
  }
  return cached;
}

/** Test/internal helper: clear the cached runtime so detection re-runs. */
export function _resetRuntimeCache(): void {
  cached = undefined;
}
