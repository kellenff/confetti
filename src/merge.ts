import type { SourceName } from "./types.js";

/** Per-layer config tree with optional merge policy. */
export interface MergeLayer {
  /** The (possibly partial) config tree for this layer. May be undefined to indicate "no contribution". */
  readonly value: unknown;
  /**
   * Array-merge policy used when THIS layer's array meets a lower
   * layer's array at the same path. Default 'replace' if absent.
   */
  readonly arrayMerge?: "replace" | "concat";
  /** Source identifier — used to build the provenance map. */
  readonly source: SourceName;
}

/**
 * Result of {@link deepMerge}: the merged value plus a provenance map
 * recording which source last wrote each leaf path. Path keys use
 * dot notation (e.g. `"server.port"`, `"tags"`); the empty string `""`
 * denotes the root.
 *
 * "Leaf" rule (A1):
 *  - Primitives (string, number, boolean, null, undefined) are leaves.
 *  - Arrays are leaves at the array path itself (no per-element entries).
 *    Whichever layer triggered the final array operation owns the path,
 *    for both `replace` and `concat` policies (the higher layer "won").
 *  - Plain objects are never recorded; their children carry provenance.
 *
 * Path encoding caveat: keys are joined with `.` without escaping. A
 * schema key that itself contains `.` (e.g. a literal field named
 * `"server.host"`) is indistinguishable from the nested path
 * `server -> host`. v0.1 does not address this; downstream consumers
 * should treat `provenance.get(p)` as meaningful only for paths that
 * currently exist in `value`.
 */
export interface MergeResult {
  readonly value: unknown;
  readonly provenance: ReadonlyMap<string, SourceName>;
}

const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Deep-merge layers in PRIORITY ORDER (low → high). Each subsequent
 * layer wins on conflict at the leaf level. Plain objects are recursed.
 * Arrays follow the higher-priority layer's `arrayMerge` policy.
 *
 * Special-case rules:
 *  - `undefined` from a higher layer means "no contribution" — keeps
 *    lower layer's value (and provenance). This is how envSource /
 *    flagsSource indicate that a key wasn't supplied.
 *  - `null` is a deliberate value, not absence. A higher null overrides.
 *  - Type mismatch (object vs primitive, array vs object) — higher wins
 *    wholesale, no merge attempted.
 *  - Prototype-pollution keys (`__proto__`, `constructor`, `prototype`)
 *    are skipped during recursion to prevent attacker-controlled config
 *    from polluting Object.prototype.
 *
 * Pure: does not mutate any input layer.
 */
export function deepMerge(layers: readonly MergeLayer[]): MergeResult {
  if (layers.length === 0) {
    return { value: undefined, provenance: new Map() };
  }

  const provenance = new Map<string, SourceName>();
  const first = layers[0];
  if (first === undefined) {
    return { value: undefined, provenance };
  }

  let result: unknown = first.value;
  recordProvenance(provenance, "", first.value, first.source);

  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    if (layer === undefined) continue;
    result = mergeOne(
      result,
      layer.value,
      layer.arrayMerge ?? "replace",
      "",
      layer.source,
      provenance,
    );
  }

  return { value: result, provenance };
}

function mergeOne(
  low: unknown,
  high: unknown,
  arrayPolicy: "replace" | "concat",
  path: string,
  source: SourceName,
  provenance: Map<string, SourceName>,
): unknown {
  if (high === undefined) return low;
  if (low === undefined) {
    recordProvenance(provenance, path, high, source);
    return high;
  }

  if (isPlainObject(low) && isPlainObject(high)) {
    const out: Record<string, unknown> = {};
    // Copy low's own enumerable string keys (skipping pollution keys defensively).
    for (const key of Object.keys(low)) {
      if (POLLUTION_KEYS.has(key)) continue;
      out[key] = low[key];
    }
    for (const key of Object.keys(high)) {
      if (POLLUTION_KEYS.has(key)) continue;
      const childPath = path === "" ? key : `${path}.${key}`;
      out[key] = mergeOne(
        out[key],
        high[key],
        arrayPolicy,
        childPath,
        source,
        provenance,
      );
    }
    return out;
  }

  if (Array.isArray(low) && Array.isArray(high)) {
    // A1: higher layer wins the merge, so it owns the array path.
    provenance.set(path, source);
    return arrayPolicy === "concat" ? [...low, ...high] : [...high];
  }

  // Type mismatch or primitives: higher wins. Prune any stale subtree
  // entries from `low` first so the map doesn't accumulate orphans
  // (e.g. {x:{y:1}} replaced by {x:1} would leave x.y dangling).
  pruneSubtree(provenance, path);
  recordProvenance(provenance, path, high, source);
  return high;
}

/**
 * Delete provenance entries rooted at `path`. For root (empty path),
 * clears the entire map. Called when a higher layer wholesale replaces
 * the subtree at `path` with a different shape (e.g. object → primitive).
 */
function pruneSubtree(provenance: Map<string, SourceName>, path: string): void {
  if (path === "") {
    provenance.clear();
    return;
  }
  const prefix = `${path}.`;
  for (const key of provenance.keys()) {
    if (key === path || key.startsWith(prefix)) {
      provenance.delete(key);
    }
  }
}

/**
 * Walk `value` and write provenance entries for every leaf path.
 * Plain objects recurse; arrays and primitives are leaves (per A1).
 */
function recordProvenance(
  provenance: Map<string, SourceName>,
  path: string,
  value: unknown,
  source: SourceName,
): void {
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (POLLUTION_KEYS.has(key)) continue;
      const childPath = path === "" ? key : `${path}.${key}`;
      recordProvenance(provenance, childPath, value[key], source);
    }
    return;
  }
  provenance.set(path, source);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype;
}
