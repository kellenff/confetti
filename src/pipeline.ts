import { z } from "zod";
import { walkSchema } from "./env-keys/walker.js";
import { AggregatedConfigError, type ConfigIssue } from "./errors.js";
import { deepMerge, type MergeLayer } from "./merge.js";
import type { Parser, Runtime, Source } from "./types.js";

/**
 * Options for {@link defineConfig}. Sources are sorted by priority,
 * so caller-supplied order is irrelevant for precedence.
 */
export interface DefineConfigOptions<T extends z.ZodTypeAny> {
  /** Zod schema. The output type drives the return type of `current`. */
  readonly schema: T;
  /** Source layers. Order is irrelevant — sorted by priority ascending. */
  readonly sources: readonly Source[];
  /**
   * Optional. Inject parsers (CSP-safe path). Keyed by format name or extension.
   *
   * NOTE (task 12): the happy-path pipeline does not own parser routing —
   * fileSource accepts its own `parsers` registry directly. This option is
   * declared on the API surface for forward compatibility (task 15 reload
   * may centralise registry construction). For now it is accepted and
   * ignored; pass parsers via fileSource({ parsers }) instead. See
   * `src/sources/file.ts` for the actual consumer.
   */
  readonly parsers?: Record<string, Parser>;
  /**
   * Optional. Custom runtime override (defaults to detected).
   *
   * NOTE (task 12): same forward-looking shape as `parsers` — sources
   * own their own runtime injection (envSource, fileSource accept a
   * `runtime` option). Reserved here for task 15.
   */
  readonly runtime?: Runtime;
}

/**
 * Loaded, validated, frozen configuration. The shape of `current`
 * matches `z.output<typeof schema>` exactly.
 *
 * Task 15 will extend this interface with reload/onChange/onError/close.
 * For task 12 we expose only `current`.
 */
export interface Config<T> {
  /** Frozen current snapshot. Direct read access — `config.current.server.port`. */
  readonly current: T;
}

/**
 * The pipeline:
 *   schema → walkSchema (eager validation; surfaces UnsupportedSchemaError)
 *          → load all sources in parallel
 *          → sort by priority asc; build MergeLayer[] (low → high)
 *          → deepMerge
 *          → schema.parse (wraps ZodError in AggregatedConfigError)
 *          → recursive Object.freeze
 *          → return Config<T>
 *
 * Source-level errors (ParseError, AggregatedConfigError from envSource,
 * etc.) propagate as-is — the pipeline only aggregates schema-level
 * validation issues, not source-load errors.
 */
export async function defineConfig<T extends z.ZodTypeAny>(
  options: DefineConfigOptions<T>,
): Promise<Config<z.output<T>>> {
  // 1. Eager schema walk — surfaces UnsupportedSchemaError synchronously
  //    before any I/O. We discard the leaves; envSource owns its own walk.
  walkSchema(options.schema);

  // 2. Load every source in parallel. A rejection from any source aborts
  //    the load — we deliberately do NOT aggregate source-load errors
  //    (per spec §2 SC3 — aggregation is for schema validation issues).
  const rawValues = await Promise.all(options.sources.map((s) => s.read()));

  // 3. Pair sources with their loaded values and sort ascending by priority.
  //    Stable sort: ties resolved by original declaration order.
  const paired = options.sources.map((source, index) => ({
    source,
    value: rawValues[index],
    index,
  }));
  paired.sort((a, b) => {
    if (a.source.priority !== b.source.priority) {
      return a.source.priority - b.source.priority;
    }
    return a.index - b.index;
  });

  // 4. Build MergeLayer[] in low → high priority order. Sources that
  //    contributed `undefined` are filtered (per merge.ts contract,
  //    undefined means "no contribution"; filtering avoids redundant work).
  const layers: MergeLayer[] = [];
  for (const entry of paired) {
    if (entry.value === undefined) continue;
    const layer: MergeLayer =
      entry.source.arrayMerge !== undefined
        ? { value: entry.value, arrayMerge: entry.source.arrayMerge }
        : { value: entry.value };
    layers.push(layer);
  }

  // 5. Deep-merge.
  const merged = deepMerge(layers);

  // 6. Schema-validate. Wrap ZodError into AggregatedConfigError so
  //    callers always see a single error type for validation failures.
  let parsed: z.output<T>;
  try {
    parsed = options.schema.parse(merged) as z.output<T>;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues: ConfigIssue[] = err.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
        // Task 13 will refine source attribution back to the contributing
        // layer. For task 12 every schema-validation issue is 'merged'.
        source: "merged",
        code: issue.code,
      }));
      throw new AggregatedConfigError(issues, { cause: err });
    }
    throw err;
  }

  // 7. Recursive freeze and return.
  const frozen = deepFreeze(parsed) as z.output<T>;
  return { current: frozen };
}

/**
 * Recursively freeze plain objects and arrays in-place. Returns the
 * same reference. Skips primitives and already-frozen / non-extensible
 * values (including class instances we might not own).
 */
function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    Object.freeze(value);
    return value;
  }
  // Only recurse into plain objects to avoid freezing class instances
  // (Date, Map, Set, user-defined classes) the user may legitimately
  // pass through via overrideSource. The schema parser usually returns
  // plain objects, but defending against this is cheap.
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  Object.freeze(value);
  return value;
}
