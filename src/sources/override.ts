import { StandardPriority, type Source } from "../types.js";

/**
 * Options for {@link overrideSource}.
 */
export interface OverrideSourceOptions {
  /** Optional. Override the source name used in diagnostics. Default: `'override'`. */
  readonly name?: string;
  /** Optional. Override the layer priority. Default: `StandardPriority.override` (`100`). */
  readonly priority?: number;
}

/**
 * Build the highest-precedence {@link Source}, intended for programmatic
 * overrides (e.g. values supplied directly by application code, a CLI
 * `--override` flag, or test fixtures).
 *
 * The supplied `value` is captured by reference; the merge layer is
 * responsible for downstream immutability (snapshots are deep-frozen).
 *
 * @example
 * ```ts
 * defineConfig({
 *   schema,
 *   sources: [fileSource({ path: 'config.yaml' }), overrideSource({ port: 9999 })],
 * });
 * ```
 */
export function overrideSource(
  value: unknown,
  options?: OverrideSourceOptions,
): Source {
  return {
    name: options?.name ?? "override",
    priority: options?.priority ?? StandardPriority.override,
    read: () => Promise.resolve(value),
  };
}
