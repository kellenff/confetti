import type { ConfigDiff } from "./types.js";

/**
 * Compute a structural difference between two config snapshots.
 *
 * Algorithm:
 *   - Primitives (or null) compared with `===`. Different → one entry at this path.
 *   - Arrays compared as wholes. Different (by length OR any index-wise inequality)
 *     → one entry carrying the entire arrays. We deliberately avoid per-index
 *     emission so that downstream consumers don't see a diff explosion when
 *     a long array is replaced or a new element is appended.
 *   - Plain objects: recursed key-by-key. Added keys emit `before: undefined`,
 *     removed keys emit `after: undefined`.
 *   - Type-mismatch (object↔primitive, object↔array, array↔primitive) at a
 *     path: ONE entry at that path; we do NOT recurse into the structured side.
 *
 * Output order is sorted lexicographically by `path.join('.')` so tests can
 * assert deterministically.
 */
export function diff(before: unknown, after: unknown): ConfigDiff {
  const entries: Array<{
    readonly path: readonly string[];
    readonly before: unknown;
    readonly after: unknown;
  }> = [];
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
  out: Array<{
    readonly path: readonly string[];
    readonly before: unknown;
    readonly after: unknown;
  }>,
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
