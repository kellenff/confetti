import { StandardPriority, type Source } from "../types.js";

/**
 * Options for {@link defaultsSource}.
 */
export interface DefaultsSourceOptions {
  /** Optional. Override the source name used in diagnostics. Default: `'default'`. */
  readonly name?: string;
  /** Optional. Override the layer priority. Default: `StandardPriority.default` (`0`). */
  readonly priority?: number;
}

/**
 * Build the lowest-precedence {@link Source} — used when no other layer
 * sets a value. Useful when you want a single fallback object that is
 * easy to read separately from the schema's own `.default()` calls.
 *
 * The supplied `value` is captured by reference; the merge layer is
 * responsible for downstream immutability (snapshots are deep-frozen).
 */
export function defaultsSource(
  value: unknown,
  options?: DefaultsSourceOptions,
): Source {
  return {
    name: options?.name ?? "default",
    priority: options?.priority ?? StandardPriority.default,
    read: () => Promise.resolve(value),
  };
}
