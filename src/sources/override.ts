import { StandardPriority, type Source } from "../types.js";

export interface OverrideSourceOptions {
  /** Optional. Override the default name (used in diagnostics). Default: 'override'. */
  readonly name?: string;
  /** Optional. Override priority. Default: StandardPriority.override (100). */
  readonly priority?: number;
}

/**
 * Highest-precedence source for programmatic overrides (e.g. CLI override).
 * Captures `value` by reference; downstream merge layer handles immutability.
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
