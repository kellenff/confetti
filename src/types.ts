/** Sync or async cleanup callback. */
export type Unwatch = () => void | Promise<void>;

/** Invoked after a successful reload. */
export type ReloadHandler = (
  next: unknown,
  diff: ConfigDiff,
) => void | Promise<void>;

/** Invoked when a subscriber or source throws during reload. */
export type ErrorHandler = (err: unknown, source: SourceName) => void;

/** Structured difference between two config snapshots. */
export type ConfigDiff = ReadonlyArray<{
  readonly path: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
}>;

/**
 * Canonical source layer names plus an open-ended string for custom sources.
 * The union is preserved for narrowing of built-in sources; user sources
 * supply their own string identifier (e.g. 'aws-secrets').
 */
export type SourceName =
  | "override"
  | "flag"
  | "env"
  | "file"
  | "default"
  | "merged"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/** Standard precedence values for built-in source layers. */
export const StandardPriority = {
  defaults: 0,
  file: 25,
  env: 50,
  flags: 75,
  override: 100,
} as const;

export type StandardPriorityValue =
  (typeof StandardPriority)[keyof typeof StandardPriority];

export interface Source {
  /** Identifier used in error messages and diagnostics. Conventionally lowercase. */
  readonly name: string;

  /**
   * Resolution order: higher priority wins on conflict.
   * Standard layers: defaults=0, file=25, env=50, flags=75, override=100.
   * Ties resolved by declaration order in defineConfig({ sources }).
   */
  readonly priority: number;

  /** Produce a (possibly partial) config tree. Returns the raw, untyped shape. */
  read(): Promise<unknown>;

  /** Optional: subscribe to changes. Sources that cannot watch (env, flags) omit this. */
  watch?(handler: ReloadHandler): Unwatch;

  /**
   * Per-source override of array merge policy.
   * 'replace' (default): higher-priority array replaces lower entirely.
   * 'concat': arrays from this source are appended to lower-priority arrays.
   */
  arrayMerge?: "replace" | "concat";
}

export interface Parser {
  /** File extensions this parser handles (without leading dot). */
  readonly extensions: readonly string[];

  /** Parse raw text into an untyped tree. Throw ParseError on failure. */
  parse(raw: string): unknown;
}

export interface Runtime {
  readFile(path: string): Promise<string>;
  readEnv(key: string): string | undefined;
  /** Returns env vars whose names start with `prefix`. Keys retain full original case. */
  listEnv(prefix: string): Record<string, string>;
  /**
   * Optional: subscribe to filesystem changes for `path`.
   * Implementations should watch the parent directory and resolve symlinks
   * to survive atomic-rename-style replacement.
   */
  watchPath?(path: string, handler: () => void): Unwatch;
}
