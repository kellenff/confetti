/**
 * Zod schema walker (task 6a).
 *
 * Traverses a Zod schema and produces a flat list of SchemaLeaf descriptors
 * that downstream code (task 6b: env-key derivation) consumes. The walker
 * REFUSES unsupported constructs at defineConfig time by throwing
 * UnsupportedSchemaError on the first offending node — silent wrong
 * behaviour is unacceptable for v0.1 (this is the long-pole risk per Klaus).
 *
 * Pinned to Zod v3.x. v4 is a separate task.
 *
 * Implementation strategy:
 *   - Prefer `instanceof` over `_def.typeName`. Zod v3 exposes the runtime
 *     classes (z.ZodString, z.ZodObject, ...). `_def.typeName` is internal
 *     and unstable; we only touch `_def` where Zod offers no public API:
 *       * ZodObject shape thunk fallback (`_def.shape()` for circular refs)
 *       * ZodEffects effect-type (only for the diagnostic schemaTypeName)
 *     Each `_def` access is annotated inline.
 *   - Wrappers (Catch, Pipe, Brand, Effects, Lazy) are checked BEFORE
 *     leaf-type checks because they wrap an inner schema and refusing them
 *     at the wrapper layer gives a more precise error message.
 *   - Optional and Default are unwrapped (they're supported wrappers).
 */

import { z } from "zod";
import {
  UnsupportedSchemaError,
  type UnsupportedSchemaReason,
} from "./unsupported.js";

export type SchemaLeafType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "literal"
  | "array";

export interface SchemaLeaf {
  /** Dotted path segments through the schema (empty = root). */
  readonly path: readonly string[];
  /** Input-side type the walker observed (for env coercion). */
  readonly inputType: SchemaLeafType;
  /** True if the leaf was wrapped in ZodOptional. */
  readonly optional: boolean;
  /** True if the leaf was wrapped in ZodDefault. */
  readonly hasDefault: boolean;
  /** For enum/literal/literal-union: the allowed scalar values. */
  readonly values?: readonly (string | number | boolean)[];
  /** For array leaves: the item type (only set when inputType === 'array'). */
  readonly itemType?: Exclude<SchemaLeafType, "array">;
  /**
   * For array-of-enum / array-of-literal / array-of-literal-union: the
   * allowed values for each array item. Mirrors `values` but applies
   * per-element rather than per-leaf. Set only when itemType is
   * 'enum' or 'literal'.
   */
  readonly itemValues?: readonly (string | number | boolean)[];
}

/**
 * Walk a Zod schema and produce one SchemaLeaf per leaf path.
 * Throws UnsupportedSchemaError on first unsupported construct.
 *
 * Use z.input<typeof schema> for the env-key derivation in task 6b —
 * .transform() is currently refused, so input/output shapes match for
 * supported schemas.
 */
export function walkSchema(schema: z.ZodTypeAny): SchemaLeaf[] {
  const leaves: SchemaLeaf[] = [];
  walk(schema, [], { optional: false, hasDefault: false }, leaves);
  return leaves;
}

interface UnwrapState {
  optional: boolean;
  hasDefault: boolean;
}

/**
 * Map of refusal types to (instanceof-class, reason). Order matters only
 * for cases where Zod inheritance would otherwise allow a wrapper to be
 * mistaken for its inner type — not currently the case in v3, but the
 * wrapper-first ordering keeps error messages closer to the surface
 * construct the user wrote.
 *
 * NOTE: ZodDiscriminatedUnion must be checked BEFORE ZodUnion in v3.x —
 * but in v3.25 they don't share inheritance, so the order is defensive,
 * not load-bearing.
 */
function refuse(
  path: readonly string[],
  reason: UnsupportedSchemaReason,
  schemaTypeName: string,
): never {
  throw new UnsupportedSchemaError({ path, reason, schemaTypeName });
}

function walk(
  schema: z.ZodTypeAny,
  path: readonly string[],
  state: UnwrapState,
  out: SchemaLeaf[],
): void {
  // ---------------------------------------------------------------
  // 1. Supported wrappers (unwrap and recurse with state mutation).
  // ---------------------------------------------------------------

  if (schema instanceof z.ZodOptional) {
    walk(schema.unwrap(), path, { ...state, optional: true }, out);
    return;
  }

  if (schema instanceof z.ZodDefault) {
    // removeDefault() is a public method that returns the inner schema.
    walk(schema.removeDefault(), path, { ...state, hasDefault: true }, out);
    return;
  }

  // ---------------------------------------------------------------
  // 2. Refused wrappers — check BEFORE leaf-type checks so the
  //    error message names the surface construct.
  // ---------------------------------------------------------------

  if (schema instanceof z.ZodEffects) {
    // ZodEffects covers .refine(), .transform(), and .preprocess(). We
    // refuse them all in v0.1 — silent transform-shape divergence is the
    // exact failure mode this walker exists to prevent.
    //
    // _def access: read effect.type purely to enrich the diagnostic
    // `schemaTypeName`. The reason code is always 'transform' regardless.
    const effectType: unknown = (schema._def as { effect?: { type?: unknown } })
      .effect?.type;
    const typeName =
      typeof effectType === "string"
        ? `ZodEffects(${effectType})`
        : "ZodEffects";
    refuse(path, "transform", typeName);
  }

  if (schema instanceof z.ZodCatch) {
    refuse(path, "catch", "ZodCatch");
  }

  if (schema instanceof z.ZodPipeline) {
    refuse(path, "pipe", "ZodPipeline");
  }

  if (schema instanceof z.ZodBranded) {
    refuse(path, "brand", "ZodBranded");
  }

  if (schema instanceof z.ZodLazy) {
    refuse(path, "lazy", "ZodLazy");
  }

  if (schema instanceof z.ZodIntersection) {
    refuse(path, "intersection", "ZodIntersection");
  }

  if (schema instanceof z.ZodRecord) {
    refuse(path, "record", "ZodRecord");
  }

  if (schema instanceof z.ZodDiscriminatedUnion) {
    refuse(path, "discriminatedUnion", "ZodDiscriminatedUnion");
  }

  if (schema instanceof z.ZodTuple) {
    refuse(path, "tuple", "ZodTuple");
  }

  if (schema instanceof z.ZodMap) {
    refuse(path, "map", "ZodMap");
  }

  if (schema instanceof z.ZodSet) {
    refuse(path, "set", "ZodSet");
  }

  if (schema instanceof z.ZodFunction) {
    refuse(path, "function", "ZodFunction");
  }

  if (schema instanceof z.ZodPromise) {
    refuse(path, "promise", "ZodPromise");
  }

  if (schema instanceof z.ZodNaN) {
    refuse(path, "nan", "ZodNaN");
  }

  if (schema instanceof z.ZodBigInt) {
    refuse(path, "bigint", "ZodBigInt");
  }

  if (schema instanceof z.ZodDate) {
    refuse(path, "date", "ZodDate");
  }

  if (schema instanceof z.ZodSymbol) {
    refuse(path, "symbol", "ZodSymbol");
  }

  if (schema instanceof z.ZodAny) {
    refuse(path, "any", "ZodAny");
  }

  if (schema instanceof z.ZodUnknown) {
    refuse(path, "unknown", "ZodUnknown");
  }

  if (schema instanceof z.ZodNever) {
    refuse(path, "never", "ZodNever");
  }

  if (schema instanceof z.ZodVoid) {
    refuse(path, "void", "ZodVoid");
  }

  if (schema instanceof z.ZodNull) {
    // ZodNull alone is unrepresentable in env. .nullable() is unsupported in
    // v0.1 (see README), but if/when it lands it will unwrap before reaching
    // here, so this branch only catches a bare z.null() at a leaf.
    refuse(path, "null", "ZodNull");
  }

  if (schema instanceof z.ZodUndefined) {
    refuse(path, "undefined", "ZodUndefined");
  }

  // ---------------------------------------------------------------
  // 3. Container: ZodObject — recurse into shape entries.
  // ---------------------------------------------------------------

  if (schema instanceof z.ZodObject) {
    // `.shape` is the documented public accessor in zod v3.23+. Earlier
    // v3 builds expose it as a getter that calls the thunk; modern builds
    // store the resolved object. Fall back to `_def.shape()` (the thunk)
    // for safety — circular-ref schemas use a thunk to defer resolution.
    //
    // _def access: shape thunk fallback. Documented internal escape hatch
    // because Zod exposes `.shape` only when not deferred.
    const shapeRaw: unknown =
      (schema as { shape?: unknown }).shape ??
      (
        schema._def as {
          shape?: () => Record<string, z.ZodTypeAny>;
        }
      ).shape?.();

    if (shapeRaw === undefined || shapeRaw === null) {
      refuse(path, "unrecognized", "ZodObject(no-shape)");
    }

    const shape = shapeRaw as Record<string, z.ZodTypeAny>;
    for (const key of Object.keys(shape)) {
      const child = shape[key];
      if (child === undefined) {
        // Defensive: noUncheckedIndexedAccess makes this required.
        continue;
      }
      // State reset is intentional: object-level optional/default does not
      // propagate to children for env-coercion purposes. An "optional
      // sub-object" only means the *whole branch* may be absent; each leaf
      // inside still owns its own optional/default flags. envSource cares
      // about per-leaf required-ness, not container-level.
      walk(child, [...path, key], { optional: false, hasDefault: false }, out);
    }
    return;
  }

  // ---------------------------------------------------------------
  // 4. Array — accept primitive-element arrays only.
  // ---------------------------------------------------------------

  if (schema instanceof z.ZodArray) {
    const desc = describePrimitive(schema.element, path);
    out.push({
      path,
      inputType: "array",
      optional: state.optional,
      hasDefault: state.hasDefault,
      itemType: desc.itemType,
      ...(desc.itemValues !== undefined ? { itemValues: desc.itemValues } : {}),
    });
    return;
  }

  // ---------------------------------------------------------------
  // 5. Enum / NativeEnum — leaf with allowed values.
  // ---------------------------------------------------------------

  if (schema instanceof z.ZodEnum) {
    const values = schema.options as readonly string[];
    out.push({
      path,
      inputType: "enum",
      optional: state.optional,
      hasDefault: state.hasDefault,
      values,
    });
    return;
  }

  if (schema instanceof z.ZodNativeEnum) {
    // schema.enum is the enum object; its values are the allowed scalars.
    const enumObj = (schema as { enum: Record<string, string | number> }).enum;
    const values = Object.values(enumObj).filter(
      (v): v is string | number =>
        typeof v === "string" || typeof v === "number",
    );
    out.push({
      path,
      inputType: "enum",
      optional: state.optional,
      hasDefault: state.hasDefault,
      values,
    });
    return;
  }

  // ---------------------------------------------------------------
  // 6. Literal — single-value leaf.
  // ---------------------------------------------------------------

  if (schema instanceof z.ZodLiteral) {
    const value = (schema as z.ZodLiteral<unknown>).value;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      // null/undefined/symbol/object literals are not representable as env
      // scalars. Refuse explicitly rather than silently coercing.
      refuse(path, "unrecognized", "ZodLiteral(non-scalar)");
    }
    out.push({
      path,
      inputType: "literal",
      optional: state.optional,
      hasDefault: state.hasDefault,
      values: [value],
    });
    return;
  }

  // ---------------------------------------------------------------
  // 7. Union — must be all-literals to be supported (becomes an enum).
  // ---------------------------------------------------------------

  if (schema instanceof z.ZodUnion) {
    // .options is the public accessor; same array as _def.options.
    const options = (
      schema as z.ZodUnion<readonly [z.ZodTypeAny, ...z.ZodTypeAny[]]>
    ).options;
    const allLiterals = options.every((opt) => opt instanceof z.ZodLiteral);
    if (!allLiterals) {
      refuse(path, "nonLiteralUnion", "ZodUnion");
    }
    const values: (string | number | boolean)[] = [];
    let firstScalarType: "string" | "number" | "boolean" | undefined;
    for (const opt of options) {
      const v = (opt as z.ZodLiteral<unknown>).value;
      if (
        typeof v !== "string" &&
        typeof v !== "number" &&
        typeof v !== "boolean"
      ) {
        refuse(path, "nonLiteralUnion", "ZodUnion(non-scalar-literal)");
      }
      // Refuse mixed scalar types in a literal union — env coercion of "1"
      // against `['a', 1]` is ambiguous, and this case is rare enough that
      // raising loud is better than guessing.
      if (firstScalarType === undefined) {
        firstScalarType = typeof v as "string" | "number" | "boolean";
      } else if (typeof v !== firstScalarType) {
        refuse(path, "nonLiteralUnion", "ZodUnion(mixed-scalar-types)");
      }
      values.push(v);
    }
    out.push({
      path,
      inputType: "enum",
      optional: state.optional,
      hasDefault: state.hasDefault,
      values,
    });
    return;
  }

  // ---------------------------------------------------------------
  // 8. Primitive leaves.
  // ---------------------------------------------------------------

  if (schema instanceof z.ZodString) {
    out.push({
      path,
      inputType: "string",
      optional: state.optional,
      hasDefault: state.hasDefault,
    });
    return;
  }

  if (schema instanceof z.ZodNumber) {
    out.push({
      path,
      inputType: "number",
      optional: state.optional,
      hasDefault: state.hasDefault,
    });
    return;
  }

  if (schema instanceof z.ZodBoolean) {
    out.push({
      path,
      inputType: "boolean",
      optional: state.optional,
      hasDefault: state.hasDefault,
    });
    return;
  }

  // ---------------------------------------------------------------
  // 9. Catch-all: an unrecognised Zod node. Throw rather than guess.
  // ---------------------------------------------------------------

  const ctorName =
    (schema as { constructor?: { name?: string } }).constructor?.name ??
    "UnknownZodNode";
  refuse(path, "unrecognized", ctorName);
}

/**
 * For ZodArray elements: the element must be a primitive Zod leaf
 * (string/number/boolean/enum/literal). Nested arrays / objects inside
 * arrays are not supported in v0.1 — refuse with 'unrecognized'.
 *
 * Wrappers around the element (.optional()/.default()) are NOT meaningful
 * inside an array element for env coercion, so we don't unwrap them here;
 * we only inspect the surface type.
 */
interface ItemDescriptor {
  itemType: Exclude<SchemaLeafType, "array">;
  itemValues?: readonly (string | number | boolean)[];
}

function describePrimitive(
  element: z.ZodTypeAny,
  path: readonly string[],
): ItemDescriptor {
  if (element instanceof z.ZodString) return { itemType: "string" };
  if (element instanceof z.ZodNumber) return { itemType: "number" };
  if (element instanceof z.ZodBoolean) return { itemType: "boolean" };
  if (element instanceof z.ZodEnum) {
    return {
      itemType: "enum",
      itemValues: element.options as readonly string[],
    };
  }
  if (element instanceof z.ZodNativeEnum) {
    const enumObj = (element as { enum: Record<string, string | number> }).enum;
    const itemValues = Object.values(enumObj).filter(
      (v): v is string | number =>
        typeof v === "string" || typeof v === "number",
    );
    return { itemType: "enum", itemValues };
  }
  if (element instanceof z.ZodLiteral) {
    const value = (element as z.ZodLiteral<unknown>).value;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new UnsupportedSchemaError({
        path,
        reason: "unrecognized",
        schemaTypeName: "ZodArray(element=ZodLiteral(non-scalar))",
      });
    }
    return { itemType: "literal", itemValues: [value] };
  }
  if (element instanceof z.ZodUnion) {
    const options = (
      element as z.ZodUnion<readonly [z.ZodTypeAny, ...z.ZodTypeAny[]]>
    ).options;
    if (options.every((o) => o instanceof z.ZodLiteral)) {
      const itemValues: (string | number | boolean)[] = [];
      let firstScalarType: "string" | "number" | "boolean" | undefined;
      for (const opt of options) {
        const v = (opt as z.ZodLiteral<unknown>).value;
        if (
          typeof v !== "string" &&
          typeof v !== "number" &&
          typeof v !== "boolean"
        ) {
          throw new UnsupportedSchemaError({
            path,
            reason: "nonLiteralUnion",
            schemaTypeName: "ZodArray(element=ZodUnion(non-scalar-literal))",
          });
        }
        if (firstScalarType === undefined) {
          firstScalarType = typeof v as "string" | "number" | "boolean";
        } else if (typeof v !== firstScalarType) {
          throw new UnsupportedSchemaError({
            path,
            reason: "nonLiteralUnion",
            schemaTypeName: "ZodArray(element=ZodUnion(mixed-scalar-types))",
          });
        }
        itemValues.push(v);
      }
      return { itemType: "enum", itemValues };
    }
  }
  const ctorName =
    (element as { constructor?: { name?: string } }).constructor?.name ??
    "UnknownZodNode";
  throw new UnsupportedSchemaError({
    path,
    reason: "unrecognized",
    schemaTypeName: `ZodArray(element=${ctorName})`,
  });
}
