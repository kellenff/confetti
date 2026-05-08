/**
 * Discriminator describing why a schema construct was rejected. See
 * {@link UnsupportedSchemaError} for context.
 */
export type UnsupportedSchemaReason =
  | "transform" // ZodEffects (refine | transform | preprocess) — refused wholesale in v0.1
  | "lazy" // ZodLazy
  | "intersection" // ZodIntersection
  | "record" // ZodRecord
  | "catch" // ZodCatch
  | "pipe" // ZodPipeline (.pipe())
  | "brand" // ZodBranded (.brand())
  | "discriminatedUnion" // ZodDiscriminatedUnion (defer to v0.2)
  | "nonLiteralUnion" // ZodUnion containing non-literal members
  | "tuple" // ZodTuple
  | "map" // ZodMap
  | "set" // ZodSet
  | "function" // ZodFunction
  | "promise" // ZodPromise
  | "nan" // ZodNaN
  | "bigint" // ZodBigInt — defer
  | "date" // ZodDate — defer (could be supported via ISO string later)
  | "symbol" // ZodSymbol
  | "any" // ZodAny — defer (unrepresentable in env)
  | "unknown" // ZodUnknown — defer
  | "never" // ZodNever
  | "void" // ZodVoid
  | "null" // ZodNull (alone — fine inside .nullable())
  | "undefined" // ZodUndefined alone
  | "unrecognized"; // catch-all for future Zod node types we haven't seen

/**
 * Thrown synchronously from `defineConfig` (and `envSource`) when the
 * Zod schema contains a construct that confetti explicitly does not
 * support in this version (e.g. `z.transform`, `z.lazy`, `z.bigint`).
 *
 * This is a programmer-time error, not a configuration-data error: it
 * fires before any source is read, during static schema validation. The
 * `path` / `reason` / `schemaTypeName` fields are intended for tooling
 * and human-readable messages — see the README "unsupported schemas"
 * section for migration tips.
 *
 * Use {@link isUnsupportedSchemaError} for type-safe narrowing.
 */
export class UnsupportedSchemaError extends Error {
  override readonly name = "UnsupportedSchemaError";
  /** Path-segments to the offending node. Empty array = schema root. */
  readonly path: readonly string[];
  /** Why the construct was rejected (categorical). */
  readonly reason: UnsupportedSchemaReason;
  /** The Zod constructor name (e.g. `'ZodTransform'`). */
  readonly schemaTypeName: string;

  constructor(opts: {
    path: readonly string[];
    reason: UnsupportedSchemaReason;
    schemaTypeName: string;
  }) {
    super(formatMessage(opts));
    this.path = opts.path;
    this.reason = opts.reason;
    this.schemaTypeName = opts.schemaTypeName;
  }
}

function formatMessage(opts: {
  path: readonly string[];
  reason: UnsupportedSchemaReason;
  schemaTypeName: string;
}): string {
  const where =
    opts.path.length > 0
      ? `at path '${opts.path.join(".")}'`
      : "at the schema root";
  return `confetti: schema construct '${opts.schemaTypeName}' (${opts.reason}) is not supported ${where}. See README 'unsupported schemas' section for migration tips.`;
}

/**
 * Type guard for {@link UnsupportedSchemaError}. Prefer this over
 * `instanceof` for cross-realm safety and consistency with
 * {@link isAggregatedConfigError} / {@link isParseError}.
 */
export function isUnsupportedSchemaError(
  e: unknown,
): e is UnsupportedSchemaError {
  return e instanceof UnsupportedSchemaError;
}
