/** Per-layer config tree with optional merge policy. */
export interface MergeLayer {
  /** The (possibly partial) config tree for this layer. May be undefined to indicate "no contribution". */
  readonly value: unknown;
  /**
   * Array-merge policy used when THIS layer's array meets a lower
   * layer's array at the same path. Default 'replace' if absent.
   */
  readonly arrayMerge?: "replace" | "concat";
}

const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Deep-merge layers in PRIORITY ORDER (low → high). Each subsequent
 * layer wins on conflict at the leaf level. Plain objects are recursed.
 * Arrays follow the higher-priority layer's `arrayMerge` policy.
 *
 * Special-case rules:
 *  - `undefined` from a higher layer means "no contribution" — keeps
 *    lower layer's value. This is how envSource/flagsSource indicate
 *    that a key wasn't supplied.
 *  - `null` is a deliberate value, not absence. A higher null overrides.
 *  - Type mismatch (object vs primitive, array vs object) — higher wins
 *    wholesale, no merge attempted.
 *  - Prototype-pollution keys (`__proto__`, `constructor`, `prototype`)
 *    are skipped during recursion to prevent attacker-controlled config
 *    from polluting Object.prototype.
 *
 * Pure: does not mutate any input layer.
 */
export function deepMerge(layers: readonly MergeLayer[]): unknown {
  if (layers.length === 0) return undefined;
  let result: unknown = layers[0]?.value;
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    if (layer === undefined) continue;
    result = mergeOne(result, layer.value, layer.arrayMerge ?? "replace");
  }
  return result;
}

function mergeOne(
  low: unknown,
  high: unknown,
  arrayPolicy: "replace" | "concat",
): unknown {
  if (high === undefined) return low;
  if (low === undefined) return high;

  if (isPlainObject(low) && isPlainObject(high)) {
    const out: Record<string, unknown> = {};
    // Copy low's own enumerable string keys (skipping pollution keys defensively).
    for (const key of Object.keys(low)) {
      if (POLLUTION_KEYS.has(key)) continue;
      out[key] = low[key];
    }
    for (const key of Object.keys(high)) {
      if (POLLUTION_KEYS.has(key)) continue;
      out[key] = mergeOne(out[key], high[key], arrayPolicy);
    }
    return out;
  }

  if (Array.isArray(low) && Array.isArray(high)) {
    return arrayPolicy === "concat" ? [...low, ...high] : [...high];
  }

  // Type mismatch or primitives: higher wins.
  return high;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype;
}
