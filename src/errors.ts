import type { SourceName } from "./types.js";

export interface ConfigIssue {
  /** Dotted path or path-segments to the offending key. Empty array = root. */
  readonly path: readonly string[];
  /** Human-readable explanation. */
  readonly message: string;
  /** Which layer provided the value (or 'merged' if structural). */
  readonly source: SourceName;
  /** Stable code for programmatic handling. Maps roughly to Zod issue codes. */
  readonly code?: string;
}

export class AggregatedConfigError extends Error {
  override readonly name = "AggregatedConfigError";
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

export function isAggregatedConfigError(
  e: unknown,
): e is AggregatedConfigError {
  return e instanceof AggregatedConfigError;
}

export class ParseError extends Error {
  override readonly name = "ParseError";
  readonly sourcePath: string;
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

export function isParseError(e: unknown): e is ParseError {
  return e instanceof ParseError;
}
