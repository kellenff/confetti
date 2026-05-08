/**
 * UnsupportedSchemaError — thrown by the schema walker (task 6a) at
 * defineConfig-time when a Zod schema contains a construct we explicitly
 * refuse to support in v0.1.
 *
 * Pattern follows src/errors.ts (custom Error subclass + type guard helper).
 *
 * No SourceName here: this error fires before any source has been read,
 * during static schema validation. It is a programmer error, not a
 * configuration-data error.
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

export class UnsupportedSchemaError extends Error {
  override readonly name = "UnsupportedSchemaError";
  readonly path: readonly string[];
  readonly reason: UnsupportedSchemaReason;
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

export function isUnsupportedSchemaError(
  e: unknown,
): e is UnsupportedSchemaError {
  return e instanceof UnsupportedSchemaError;
}
