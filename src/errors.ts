import type { SourceName } from "./types.js";

/**
 * A single validation issue surfaced by {@link AggregatedConfigError}.
 *
 * Each issue carries enough context to point a developer or operator at
 * the offending value: where it lives in the config tree, which layer
 * provided it, a human-readable explanation, and (when available) a
 * stable code that maps roughly to the originating Zod issue code.
 */
export interface ConfigIssue {
  /** Path-segments to the offending key. Empty array = root. */
  readonly path: readonly string[];
  /** Human-readable explanation. */
  readonly message: string;
  /** Which layer provided the value, or `'merged'` when the failure is structural. */
  readonly source: SourceName;
  /** Stable code for programmatic handling. Maps roughly to Zod issue codes. */
  readonly code?: string;
}

/**
 * Aggregated error thrown when one or more {@link ConfigIssue}s are
 * detected during schema validation.
 *
 * `confetti` aggregates every validation failure into a single throw so
 * callers can surface the full picture in one shot rather than fixing
 * issues one Zod error at a time. Use {@link isAggregatedConfigError}
 * for type-safe narrowing in `catch` blocks.
 *
 * The `cause` (when supplied) is typically the underlying `ZodError`
 * for callers that want to reach beneath the aggregated view.
 */
export class AggregatedConfigError extends Error {
  override readonly name = "AggregatedConfigError";
  /** Every issue surfaced during this validation pass. */
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[], options?: { cause?: unknown }) {
    super(formatIssues(issues), options);
    this.issues = issues;
  }
}

function formatIssues(issues: readonly ConfigIssue[]): string {
  if (issues.length === 0)
    return "Config validation failed (no issues recorded)";
  const header = `Config validation failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):`;
  const lines = issues.map((i) => {
    const where = i.path.length > 0 ? i.path.join(".") : "(root)";
    return `  - ${where} [${i.source}]: ${i.message}`;
  });
  return [header, ...lines].join("\n");
}

/**
 * Type guard for {@link AggregatedConfigError}. Prefer this over
 * `instanceof` for cross-realm safety and consistency with
 * {@link isParseError} / {@link isUnsupportedSchemaError}.
 */
export function isAggregatedConfigError(
  e: unknown,
): e is AggregatedConfigError {
  return e instanceof AggregatedConfigError;
}

/**
 * Error thrown when a file's contents cannot be parsed by the
 * registered {@link Parser}.
 *
 * `fileSource` wraps any error thrown out of `Parser.parse` in a
 * `ParseError` with the source path and parser name attached, so callers
 * always get path-aware diagnostics regardless of which parser failed.
 *
 * Use {@link isParseError} for type-safe narrowing in `catch` blocks.
 */
export class ParseError extends Error {
  override readonly name = "ParseError";
  /** Path of the file that failed to parse. */
  readonly sourcePath: string;
  /** Format key / parser name (e.g. `'yaml'`, `'toml'`). */
  readonly parserName: string;

  constructor(
    message: string,
    options: { sourcePath: string; parserName: string; cause?: unknown },
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.sourcePath = options.sourcePath;
    this.parserName = options.parserName;
  }
}

/**
 * Type guard for {@link ParseError}. Prefer this over `instanceof` for
 * cross-realm safety and consistency with the other guard helpers.
 */
export function isParseError(e: unknown): e is ParseError {
  return e instanceof ParseError;
}
