import type { ConfigDiff } from "./types.js";

type DiffEntry = ConfigDiff[number];

/**
 * Compute a structural difference between two config snapshots.
 *
 * Useful for comparing arbitrary snapshots from your application code —
 * the same routine is used internally to build the `diff` argument
 * passed to {@link ReloadHandler}.
 *
 * @param before - The earlier snapshot.
 * @param after - The later snapshot.
 * @returns A {@link ConfigDiff} — array of entries, one per logical
 *   change, sorted lexicographically by `path.join('.')`.
 *
 * Algorithm:
 *
 * - **Primitives** (and `null`) are compared with `===`. A difference
 *   yields one entry at this path.
 * - **Arrays** are compared as wholes. Any difference (by length OR any
 *   index-wise inequality) yields one entry carrying the entire arrays.
 *   Per-index emission is deliberately avoided to prevent diff
 *   explosions when a long array is replaced or appended to.
 * - **Plain objects** are recursed key-by-key. Added keys emit
 *   `before: undefined`; removed keys emit `after: undefined`.
 * - **Type-mismatch** (object↔primitive, object↔array, array↔primitive):
 *   one entry at that path with no recursion into the structured side.
 */
export function diff(before: unknown, after: unknown): ConfigDiff {
  const entries: Array<DiffEntry> = [];
  walk([], before, after, entries);
  entries.sort((a, b) => {
    const ka = a.path.join(".");
    const kb = b.path.join(".");
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
  return entries;
}

function walk(
  path: readonly string[],
  before: unknown,
  after: unknown,
  out: Array<DiffEntry>,
): void {
  if (sameValue(before, after)) return;

  const beforeKind = kindOf(before);
  const afterKind = kindOf(after);

  // Type-mismatch (including object↔primitive, array↔primitive, array↔object).
  if (beforeKind !== afterKind) {
    out.push({ path, before, after });
    return;
  }

  if (beforeKind === "array") {
    // Arrays compared as wholes — one entry, no per-index recursion.
    out.push({ path, before, after });
    return;
  }

  if (beforeKind === "object") {
    const a = before as Record<string, unknown>;
    const b = after as Record<string, unknown>;
    const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const inA = Object.prototype.hasOwnProperty.call(a, key);
      const inB = Object.prototype.hasOwnProperty.call(b, key);
      if (inA && !inB) {
        out.push({ path: [...path, key], before: a[key], after: undefined });
      } else if (!inA && inB) {
        out.push({ path: [...path, key], before: undefined, after: b[key] });
      } else {
        walk([...path, key], a[key], b[key], out);
      }
    }
    return;
  }

  // Primitive change.
  out.push({ path, before, after });
}

type Kind = "primitive" | "array" | "object";

function kindOf(value: unknown): Kind {
  if (value === null || typeof value !== "object") return "primitive";
  if (Array.isArray(value)) return "array";
  return "object";
}

/**
 * Structural equality used to short-circuit `walk`. Mirrors the diff
 * semantics: arrays compare element-wise, objects compare key-wise,
 * primitives compare with `===` (so `NaN !== NaN`, matching JS norms).
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb) return false;
  if (ka === "primitive") return false; // already failed ===
  if (ka === "array") {
    const aa = a as readonly unknown[];
    const bb = b as readonly unknown[];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (!sameValue(aa[i], bb[i])) return false;
    }
    return true;
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const ka2 = Object.keys(oa);
  const kb2 = Object.keys(ob);
  if (ka2.length !== kb2.length) return false;
  for (const k of ka2) {
    if (!Object.prototype.hasOwnProperty.call(ob, k)) return false;
    if (!sameValue(oa[k], ob[k])) return false;
  }
  return true;
}
