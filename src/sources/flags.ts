import { StandardPriority, type Source } from "../types.js";

export interface FlagsSourceOptions {
  /** Optional. Override the default name (used in diagnostics). Default: 'flag'. */
  readonly name?: string;
  /** Optional. Override priority. Default: StandardPriority.flag (75). */
  readonly priority?: number;
}

/**
 * Source for pre-parsed CLI flags. We do not parse argv here; the caller
 * supplies the already-parsed object. Captures `value` by reference.
 */
export function flagsSource(
  value: unknown,
  options?: FlagsSourceOptions,
): Source {
  return {
    name: options?.name ?? "flag",
    priority: options?.priority ?? StandardPriority.flag,
    read: () => Promise.resolve(value),
  };
}
