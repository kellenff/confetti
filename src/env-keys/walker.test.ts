import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  isUnsupportedSchemaError,
  UnsupportedSchemaError,
} from "./unsupported.js";
import { type SchemaLeaf, walkSchema } from "./walker.js";

/**
 * Sanity check: the walker uses `instanceof` against z.ZodString etc.
 * If a Zod major-version bump renames or restructures these, we want to
 * fail loudly here rather than silently produce wrong leaves at runtime.
 */
describe("Zod runtime classes (load-bearing assumption)", () => {
  // Every runtime class the walker uses with `instanceof`. If a Zod minor
  // version renames or restructures any of these, this suite fails first
  // — before the walker silently falls through to 'unrecognized'.
  it.each<[string, () => unknown, new (...args: never[]) => unknown]>([
    ["ZodString", () => z.string(), z.ZodString],
    ["ZodNumber", () => z.number(), z.ZodNumber],
    ["ZodBoolean", () => z.boolean(), z.ZodBoolean],
    ["ZodObject", () => z.object({}), z.ZodObject],
    ["ZodArray", () => z.array(z.string()), z.ZodArray],
    ["ZodOptional", () => z.string().optional(), z.ZodOptional],
    ["ZodDefault", () => z.string().default("x"), z.ZodDefault],
    ["ZodEnum", () => z.enum(["a"]), z.ZodEnum],
    ["ZodNativeEnum", () => z.nativeEnum({ A: "a" } as const), z.ZodNativeEnum],
    ["ZodLiteral", () => z.literal("x"), z.ZodLiteral],
    ["ZodUnion", () => z.union([z.string(), z.number()]), z.ZodUnion],
    [
      "ZodEffects (transform)",
      () => z.string().transform((s) => s),
      z.ZodEffects,
    ],
    ["ZodEffects (refine)", () => z.string().refine(() => true), z.ZodEffects],
    ["ZodCatch", () => z.string().catch("x"), z.ZodCatch],
    ["ZodPipeline", () => z.string().pipe(z.string()), z.ZodPipeline],
    ["ZodBranded", () => z.string().brand<"X">(), z.ZodBranded],
    ["ZodLazy", () => z.lazy(() => z.string()), z.ZodLazy],
    [
      "ZodIntersection",
      () => z.intersection(z.string(), z.string()),
      z.ZodIntersection,
    ],
    ["ZodRecord", () => z.record(z.string()), z.ZodRecord],
    [
      "ZodDiscriminatedUnion",
      () =>
        z.discriminatedUnion("k", [
          z.object({ k: z.literal("a") }),
          z.object({ k: z.literal("b") }),
        ]),
      z.ZodDiscriminatedUnion,
    ],
    ["ZodTuple", () => z.tuple([z.string()]), z.ZodTuple],
    ["ZodMap", () => z.map(z.string(), z.string()), z.ZodMap],
    ["ZodSet", () => z.set(z.string()), z.ZodSet],
    ["ZodFunction", () => z.function(), z.ZodFunction],
    ["ZodPromise", () => z.promise(z.string()), z.ZodPromise],
    ["ZodNaN", () => z.nan(), z.ZodNaN],
    ["ZodBigInt", () => z.bigint(), z.ZodBigInt],
    ["ZodDate", () => z.date(), z.ZodDate],
    ["ZodSymbol", () => z.symbol(), z.ZodSymbol],
    ["ZodAny", () => z.any(), z.ZodAny],
    ["ZodUnknown", () => z.unknown(), z.ZodUnknown],
    ["ZodNever", () => z.never(), z.ZodNever],
    ["ZodVoid", () => z.void(), z.ZodVoid],
    ["ZodNull", () => z.null(), z.ZodNull],
    ["ZodUndefined", () => z.undefined(), z.ZodUndefined],
  ])("exposes %s as a runtime class", (_name, build, Class) => {
    expect(build()).toBeInstanceOf(Class);
  });
});

// Helper: collect a thrown UnsupportedSchemaError for assertion.
function catchUnsupported(fn: () => unknown): UnsupportedSchemaError {
  try {
    fn();
  } catch (e) {
    if (isUnsupportedSchemaError(e)) return e;
    throw e;
  }
  throw new Error("Expected UnsupportedSchemaError to be thrown, got nothing");
}

describe("walkSchema — supported constructs", () => {
  it("flat object with primitives", () => {
    const schema = z.object({ port: z.number(), host: z.string() });
    const leaves = walkSchema(schema);
    expect(leaves).toHaveLength(2);
    expect(leaves).toContainEqual<SchemaLeaf>({
      path: ["port"],
      inputType: "number",
      optional: false,
      hasDefault: false,
    });
    expect(leaves).toContainEqual<SchemaLeaf>({
      path: ["host"],
      inputType: "string",
      optional: false,
      hasDefault: false,
    });
  });

  it("nested object", () => {
    const schema = z.object({
      db: z.object({ url: z.string() }),
      debug: z.boolean(),
    });
    const leaves = walkSchema(schema);
    expect(leaves).toHaveLength(2);
    expect(leaves).toContainEqual<SchemaLeaf>({
      path: ["db", "url"],
      inputType: "string",
      optional: false,
      hasDefault: false,
    });
    expect(leaves).toContainEqual<SchemaLeaf>({
      path: ["debug"],
      inputType: "boolean",
      optional: false,
      hasDefault: false,
    });
  });

  it("optional + default propagate to leaves", () => {
    const schema = z.object({
      port: z.number().default(3000),
      host: z.string().optional(),
    });
    const leaves = walkSchema(schema);
    expect(leaves).toContainEqual<SchemaLeaf>({
      path: ["port"],
      inputType: "number",
      optional: false,
      hasDefault: true,
    });
    expect(leaves).toContainEqual<SchemaLeaf>({
      path: ["host"],
      inputType: "string",
      optional: true,
      hasDefault: false,
    });
  });

  it("optional default (both wrappers stacked) propagates both flags", () => {
    const schema = z.object({
      port: z.number().optional().default(3000),
    });
    const leaves = walkSchema(schema);
    // .default() is the outer wrapper here, optional is inner.
    expect(leaves[0]).toMatchObject({
      path: ["port"],
      inputType: "number",
      hasDefault: true,
      optional: true,
    });
  });

  it("default optional (reverse wrapper order) also propagates both flags", () => {
    const schema = z.object({
      port: z.number().default(3000).optional(),
    });
    const leaves = walkSchema(schema);
    // .optional() is the outer wrapper here, default is inner.
    expect(leaves[0]).toMatchObject({
      path: ["port"],
      inputType: "number",
      hasDefault: true,
      optional: true,
    });
  });

  it("optional sub-object: state intentionally resets at object boundary", () => {
    // Documented behaviour: object-level optional/default does NOT propagate
    // to children. Each leaf inside still owns its own optional/default
    // flags. envSource cares about per-leaf required-ness, not container.
    const schema = z.object({
      db: z
        .object({ url: z.string(), pool: z.number().default(10) })
        .optional(),
    });
    const leaves = walkSchema(schema);
    expect(leaves).toHaveLength(2);
    expect(leaves).toContainEqual<SchemaLeaf>({
      path: ["db", "url"],
      inputType: "string",
      optional: false,
      hasDefault: false,
    });
    expect(leaves).toContainEqual<SchemaLeaf>({
      path: ["db", "pool"],
      inputType: "number",
      optional: false,
      hasDefault: true,
    });
  });

  it("enum produces enum leaf with values", () => {
    const schema = z.object({ env: z.enum(["dev", "prod"]) });
    const leaves = walkSchema(schema);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toMatchObject({
      path: ["env"],
      inputType: "enum",
      optional: false,
      hasDefault: false,
    });
    expect(leaves[0]?.values).toEqual(["dev", "prod"]);
  });

  it("native enum produces enum leaf with values", () => {
    const Color = { Red: "red", Blue: "blue" } as const;
    const schema = z.object({ color: z.nativeEnum(Color) });
    const leaves = walkSchema(schema);
    expect(leaves[0]).toMatchObject({
      path: ["color"],
      inputType: "enum",
    });
    expect(leaves[0]?.values).toEqual(expect.arrayContaining(["red", "blue"]));
  });

  it("literal produces literal leaf with single value", () => {
    const schema = z.object({ kind: z.literal("singleton") });
    const leaves = walkSchema(schema);
    expect(leaves[0]).toMatchObject({
      path: ["kind"],
      inputType: "literal",
    });
    expect(leaves[0]?.values).toEqual(["singleton"]);
  });

  it("literal-union produces enum leaf with combined values", () => {
    const schema = z.object({
      mode: z.union([z.literal("a"), z.literal("b")]),
    });
    const leaves = walkSchema(schema);
    expect(leaves[0]).toMatchObject({
      path: ["mode"],
      inputType: "enum",
    });
    expect(leaves[0]?.values).toEqual(["a", "b"]);
  });

  it("primitive array (string)", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const leaves = walkSchema(schema);
    expect(leaves[0]).toEqual<SchemaLeaf>({
      path: ["tags"],
      inputType: "array",
      optional: false,
      hasDefault: false,
      itemType: "string",
    });
  });

  it("primitive array (number)", () => {
    const schema = z.object({ ports: z.array(z.number()) });
    const leaves = walkSchema(schema);
    expect(leaves[0]?.itemType).toBe("number");
  });

  it("primitive array of enums", () => {
    const schema = z.object({ flags: z.array(z.enum(["x", "y"])) });
    const leaves = walkSchema(schema);
    expect(leaves[0]).toMatchObject({
      path: ["flags"],
      inputType: "array",
      itemType: "enum",
    });
  });

  it("array of enum carries itemValues", () => {
    const schema = z.object({ flags: z.array(z.enum(["x", "y", "z"])) });
    const leaves = walkSchema(schema);
    expect(leaves[0]?.itemValues).toEqual(["x", "y", "z"]);
  });

  it("array of literal carries itemValues", () => {
    const schema = z.object({ kinds: z.array(z.literal("singleton")) });
    const leaves = walkSchema(schema);
    expect(leaves[0]).toMatchObject({
      inputType: "array",
      itemType: "literal",
    });
    expect(leaves[0]?.itemValues).toEqual(["singleton"]);
  });

  it("array of literal-union carries itemValues", () => {
    const schema = z.object({
      modes: z.array(z.union([z.literal("a"), z.literal("b")])),
    });
    const leaves = walkSchema(schema);
    expect(leaves[0]).toMatchObject({
      inputType: "array",
      itemType: "enum",
    });
    expect(leaves[0]?.itemValues).toEqual(["a", "b"]);
  });

  it("array of string has no itemValues", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const leaves = walkSchema(schema);
    expect(leaves[0]?.itemValues).toBeUndefined();
  });
});

describe("walkSchema — refused constructs", () => {
  // NOTE: in zod v3, .refine() wraps the schema in a ZodEffects with
  // effect.type === 'refinement'. We refuse the entire ZodEffects node
  // wholesale (reason: 'transform') because v0.1 cannot reason about the
  // input/output divergence introduced by transforms, and refusing only
  // the transform variant would silently let refinements through —
  // surprising behaviour we explicitly want to avoid.

  it.each<[string, () => z.ZodTypeAny, string]>([
    [
      "transform",
      () => z.string().transform((s) => s.toUpperCase()),
      "transform",
    ],
    [
      "refine (also ZodEffects)",
      () => z.string().refine(() => true),
      "transform",
    ],
    [
      "preprocess (also ZodEffects)",
      () => z.preprocess((v) => v, z.string()),
      "transform",
    ],
    ["lazy", () => z.lazy(() => z.string()), "lazy"],
    [
      "intersection",
      () => z.intersection(z.string(), z.number()),
      "intersection",
    ],
    ["record", () => z.record(z.string()), "record"],
    ["catch", () => z.string().catch("default"), "catch"],
    ["pipe", () => z.string().pipe(z.string()), "pipe"],
    ["brand", () => z.string().brand<"X">(), "brand"],
    [
      "non-literal union",
      () => z.union([z.string(), z.number()]),
      "nonLiteralUnion",
    ],
    ["tuple", () => z.tuple([z.string()]), "tuple"],
    [
      "discriminated union",
      () =>
        z.discriminatedUnion("k", [
          z.object({ k: z.literal("a") }),
          z.object({ k: z.literal("b") }),
        ]),
      "discriminatedUnion",
    ],
    ["map", () => z.map(z.string(), z.string()), "map"],
    ["set", () => z.set(z.string()), "set"],
    ["function", () => z.function(), "function"],
    ["promise", () => z.promise(z.string()), "promise"],
    ["nan", () => z.nan(), "nan"],
    ["bigint", () => z.bigint(), "bigint"],
    ["date", () => z.date(), "date"],
    ["symbol", () => z.symbol(), "symbol"],
    ["any", () => z.any(), "any"],
    ["unknown", () => z.unknown(), "unknown"],
    ["never", () => z.never(), "never"],
    ["void", () => z.void(), "void"],
    ["bare null", () => z.null(), "null"],
    ["bare undefined", () => z.undefined(), "undefined"],
  ])("refuses %s with reason '%s'", (_label, build, expectedReason) => {
    const schema = build();
    expect(() => walkSchema(schema)).toThrow(UnsupportedSchemaError);
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.reason).toBe(expectedReason);
  });

  it("refuses .nullable() in v0.1 (skipped support — would unwrap as 'null' alone)", () => {
    // .nullable() wraps in ZodNullable. The walker does not currently
    // recognise ZodNullable, so it falls through to the catch-all
    // 'unrecognized'. If/when nullable lands as a supported wrapper,
    // this test should be updated. Documented per task spec: "Do NOT
    // support .nullable() in v0.1 unless trivially free".
    const schema = z.string().nullable();
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.reason).toBe("unrecognized");
    expect(err.schemaTypeName).toBe("ZodNullable");
  });

  it("refuses array of objects (v0.1 only supports primitive-element arrays)", () => {
    const schema = z.object({ rows: z.array(z.object({ a: z.string() })) });
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.reason).toBe("unrecognized");
    expect(err.path).toEqual(["rows"]);
  });

  it("refuses array of arrays", () => {
    const schema = z.object({ grid: z.array(z.array(z.number())) });
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.reason).toBe("unrecognized");
    expect(err.path).toEqual(["grid"]);
  });

  it("refuses mixed-scalar literal union (string + number)", () => {
    // Env coercion of "1" against ['a', 1] is ambiguous; refuse loudly.
    const schema = z.object({
      v: z.union([z.literal("a"), z.literal(1)]),
    });
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.reason).toBe("nonLiteralUnion");
    expect(err.schemaTypeName).toContain("mixed-scalar-types");
  });

  it("refuses array of mixed-scalar literal union", () => {
    const schema = z.object({
      v: z.array(z.union([z.literal("a"), z.literal(1)])),
    });
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.reason).toBe("nonLiteralUnion");
    expect(err.schemaTypeName).toContain("mixed-scalar-types");
  });
});

describe("walkSchema — error path correctness", () => {
  it("reports the offending path for a deeply-nested unsupported node", () => {
    const schema = z.object({
      service: z.object({
        retry: z.object({
          // ZodEffects buried two levels deep
          backoff: z.string().transform((s) => Number(s)),
        }),
      }),
    });
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.reason).toBe("transform");
    expect(err.path).toEqual(["service", "retry", "backoff"]);
  });

  it("reports root path for a top-level unsupported schema", () => {
    const schema = z.string().transform((s) => s);
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.path).toEqual([]);
    expect(err.message).toContain("at the schema root");
  });

  it("reports correct path for a non-literal union nested in object", () => {
    const schema = z.object({
      cfg: z.object({
        v: z.union([z.string(), z.number()]),
      }),
    });
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.reason).toBe("nonLiteralUnion");
    expect(err.path).toEqual(["cfg", "v"]);
  });

  it("error message includes the schema type name and path", () => {
    const schema = z.object({ x: z.bigint() });
    const err = catchUnsupported(() => walkSchema(schema));
    expect(err.message).toContain("ZodBigInt");
    expect(err.message).toContain("bigint");
    expect(err.message).toContain("x");
  });
});

describe("isUnsupportedSchemaError", () => {
  it("narrows correctly", () => {
    const err: unknown = new UnsupportedSchemaError({
      path: ["a"],
      reason: "lazy",
      schemaTypeName: "ZodLazy",
    });
    expect(isUnsupportedSchemaError(err)).toBe(true);
    expect(isUnsupportedSchemaError(new Error("nope"))).toBe(false);
    expect(isUnsupportedSchemaError(null)).toBe(false);
  });
});
