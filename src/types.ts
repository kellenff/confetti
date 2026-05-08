/**
 * A teardown function returned by subscriptions and source watchers.
 *
 * May be synchronous (returns `void`) or asynchronous (returns
 * `Promise<void>`); callers MUST handle both. Implementations should be
 * idempotent — calling the returned `Unwatch` more than once must be safe.
 */
export type Unwatch = () => void | Promise<void>;

/**
 * Handler invoked after a successful reload of a `Config`.
 *
 * @param next - The newly-loaded, validated, frozen snapshot. Typed as
 *   `unknown` because handlers are registered against the public
 *   {@link Unwatch}-returning `onChange` API which is non-generic; cast
 *   to your schema's output type if needed.
 * @param diff - Structural difference between the previous and new
 *   snapshot. See {@link ConfigDiff} for shape and ordering.
 *
 * Handlers run in registration order. If a handler throws or rejects,
 * the error is routed to registered {@link ErrorHandler}s with
 * `source: 'merged'`; remaining handlers still run.
 */
export type ReloadHandler = (
  next: unknown,
  diff: ConfigDiff,
) => void | Promise<void>;

/**
 * Handler invoked when a source or subscriber raises an error.
 *
 * @param err - The thrown / rejected value. May be any type — `Error`
 *   subclasses are typical but not guaranteed.
 * @param source - Identifier of the originating layer. Use
 *   {@link isAggregatedConfigError} / {@link isParseError} to narrow
 *   on `err`, and the {@link SourceName} to attribute the failure.
 *
 * Handlers run synchronously in registration order. Rejections are not
 * awaited — fire-and-forget.
 */
export type ErrorHandler = (err: unknown, source: SourceName) => void;

/**
 * Structural difference between two configuration snapshots, returned
 * by {@link diff} and supplied to {@link ReloadHandler}.
 *
 * Each entry represents one logical change. Entries are sorted
 * lexicographically by `path.join('.')` for deterministic ordering.
 *
 * - `path` is the segment path from the root to the changed node.
 *   An empty array represents the root itself.
 * - `before` and `after` capture the old and new values at that path.
 *   Either may be `undefined` to represent an added or removed key.
 * - Arrays are compared as wholes — see {@link diff} for full semantics.
 */
export type ConfigDiff = ReadonlyArray<{
  /** Segment path from the snapshot root to the changed node. Empty = root. */
  readonly path: readonly string[];
  /** Value at this path in the previous snapshot. `undefined` = key was added. */
  readonly before: unknown;
  /** Value at this path in the new snapshot. `undefined` = key was removed. */
  readonly after: unknown;
}>;

/**
 * Identifier of a configuration layer.
 *
 * The literal members cover every built-in source plus `'merged'`, which
 * is reported when an error cannot be attributed to a specific layer
 * (e.g. validation failures whose offending key was never written by
 * any layer). Custom sources supply their own string identifier — the
 * `string & {}` branch keeps that branch open while still preserving
 * narrowing on the literals.
 */
export type SourceName =
  | "override"
  | "flag"
  | "env"
  | "file"
  | "default"
  | "merged"
  | (string & {});

/**
 * Canonical priority values for the built-in source layers.
 *
 * Higher values win on conflict. Keys match the singular
 * {@link SourceName} literals (`'default'`, not `'defaults'`) so
 * consumers can write `StandardPriority[name]` without translation:
 *
 * ```ts
 * import { StandardPriority, fileSource } from 'confetti';
 * fileSource({ path: 'config.json', priority: StandardPriority.file });
 * ```
 *
 * Custom sources are free to pick any numeric priority; ties are
 * resolved by declaration order in `defineConfig({ sources })`.
 */
export const StandardPriority = {
  /** Defaults layer — lowest precedence. Value: `0`. */
  default: 0,
  /** File layer (e.g. `config.yaml`). Value: `25`. */
  file: 25,
  /** Environment-variable layer. Value: `50`. */
  env: 50,
  /** CLI-flag layer. Value: `75`. */
  flag: 75,
  /** Programmatic-override layer — highest precedence. Value: `100`. */
  override: 100,
} as const;

/**
 * Union of the literal numeric values in {@link StandardPriority}.
 *
 * Useful when typing a `priority` field that should accept any of the
 * canonical layer values: `0 | 25 | 50 | 75 | 100`.
 */
export type StandardPriorityValue =
  (typeof StandardPriority)[keyof typeof StandardPriority];

/**
 * A single configuration layer.
 *
 * Implement this to integrate a custom source (e.g. AWS Secrets, Vault,
 * a remote-config service). The pipeline owns merge, validation,
 * freezing, and notification — sources only produce raw, untyped data
 * and (optionally) signal when that data has changed.
 */
export interface Source {
  /**
   * Identifier used in error messages, diagnostics, and
   * {@link ErrorHandler}'s `source` argument. Conventionally lowercase.
   */
  readonly name: string;

  /**
   * Resolution order: higher priority wins on conflict.
   *
   * Standard layer values: `default=0, file=25, env=50, flag=75,
   * override=100`. See {@link StandardPriority}. Ties are resolved
   * by declaration order in `defineConfig({ sources })`.
   */
  readonly priority: number;

  /**
   * Produce a (possibly partial) configuration tree. Returns the raw,
   * untyped shape; the pipeline merges and validates downstream.
   *
   * Resolving with `undefined` signals "this layer contributes nothing"
   * and the pipeline skips it during merge. Rejections abort the load
   * and propagate via {@link ErrorHandler} (on reload) or the original
   * `defineConfig` promise (on initial load).
   */
  read(): Promise<unknown>;

  /**
   * Optional. Subscribe to changes for this layer.
   *
   * Sources that cannot watch (env, flags, override) omit this method.
   *
   * @param notify - Zero-argument signal. Sources only know that
   *   something changed; the pipeline owns recomputation of the next
   *   snapshot and dispatches via its own `onChange` handlers.
   * @param onError - Optional pipeline-supplied bridge for failures the
   *   source cannot surface synchronously through the returned
   *   {@link Unwatch} (e.g. async `watchFile` startup rejection). The
   *   pipeline routes these to its own `Config.onError(err, source.name)`
   *   channel. Implementations MAY ignore this parameter.
   * @returns An {@link Unwatch} function that tears the watch down.
   */
  watch?(notify: () => void, onError?: (err: unknown) => void): Unwatch;

  /**
   * Optional. Per-source override of the array merge policy.
   *
   * - `'replace'` (default): higher-priority array replaces the
   *   lower-priority array entirely.
   * - `'concat'`: arrays from this source are appended to lower-priority
   *   arrays.
   */
  arrayMerge?: "replace" | "concat";
}

/**
 * A pluggable text-format parser used by {@link fileSource}.
 *
 * Implementations parse raw file contents into an untyped tree which is
 * then merged and validated downstream. Throwing from `parse` causes
 * `fileSource` to wrap the failure in a {@link ParseError} with
 * source-path context.
 */
export interface Parser {
  /**
   * File extensions this parser handles, lowercased and without the
   * leading dot (e.g. `['yaml', 'yml']`).
   */
  readonly extensions: readonly string[];

  /**
   * Parse raw text into an untyped tree.
   *
   * @throws Any error type. `fileSource` wraps thrown errors in
   *   {@link ParseError} with the source path and parser name attached.
   */
  parse(raw: string): unknown;
}

/**
 * Runtime abstraction used by `envSource` and `fileSource` to read
 * the host environment and the filesystem.
 *
 * Confetti detects the host runtime (Node, Deno, Bun) automatically;
 * supply a custom `Runtime` only when testing or when running in a
 * sandboxed environment that needs a custom shim.
 */
export interface Runtime {
  /** Read a file's contents as UTF-8 text. Rejects with a runtime-specific error if the file is missing. */
  readFile(path: string): Promise<string>;
  /** Read a single environment variable. Returns `undefined` when unset. */
  readEnv(key: string): string | undefined;
  /**
   * Return all environment variables whose names start with `prefix`.
   * Keys retain their full original case.
   */
  listEnv(prefix: string): Record<string, string>;
  /**
   * Optional. Subscribe to filesystem changes for `path`.
   *
   * Implementations should watch the parent directory and resolve
   * symlinks to survive atomic-rename-style replacement (editors that
   * write to a temp file and rename).
   *
   * @returns An {@link Unwatch} function that tears the watch down.
   */
  watchPath?(path: string, handler: () => void): Unwatch;
}
