import { StandardPriority, type Source } from "../types.js";

export interface DefaultsSourceOptions {
  /** Optional. Override the default name (used in diagnostics). Default: 'default'. */
  readonly name?: string;
  /** Optional. Override priority. Default: StandardPriority.default (0). */
  readonly priority?: number;
}

/**
 * Lowest-precedence source — used when no other layer sets a value.
 * Captures `value` by reference; downstream merge layer handles immutability.
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
