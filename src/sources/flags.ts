import { StandardPriority, type Source } from "../types.js";

/**
 * Options for {@link flagsSource}.
 */
export interface FlagsSourceOptions {
  /** Optional. Override the source name used in diagnostics. Default: `'flag'`. */
  readonly name?: string;
  /** Optional. Override the layer priority. Default: `StandardPriority.flag` (`75`). */
  readonly priority?: number;
}

/**
 * Build a {@link Source} representing pre-parsed CLI flags.
 *
 * Confetti deliberately does not parse `argv` itself — the caller is
 * expected to use whichever argv parser they prefer (`yargs`, `commander`,
 * `mri`, the built-in `util.parseArgs`) and pass the already-parsed
 * object as `value`. The supplied object is captured by reference.
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
