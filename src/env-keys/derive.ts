/**
 * Env-key derivation (task 6b).
 *
 * Given the flat list of SchemaLeaf descriptors produced by walkSchema
 * (task 6a), compute the env-var name to read for each leaf. The
 * mapping retains the ORIGINAL case-preserving path so that the env
 * source can assign the resulting value back to the correct slot in
 * the merged config tree.
 *
 * Conversion rules per segment (input-side only, the original path is
 * untouched):
 *   1. `.` and `-` become `_` (defensive — walker shouldn't emit `.`).
 *   2. Acronym-aware camelCase split:
 *        a) `([a-z\d])([A-Z])` → `$1_$2`     (lower|digit → Upper)
 *        b) `([A-Z]+)([A-Z][a-z])` → `$1_$2` (run-of-Upper → Upper+lower)
 *      Pass (b) runs first so `XMLHttpRequest` becomes `XML_HttpRequest`
 *      before pass (a) splits `pR` → `p_R`, yielding `XML_Http_Request`.
 *   3. Uppercase the whole segment.
 *
 * Callers should detect collisions (two distinct paths producing the
 * same envName) — this module returns mappings as-is, intentionally,
 * because deciding policy (last-wins, throw, warn) belongs to the caller.
 */

import type { SchemaLeaf } from "./walker.js";

export interface EnvKeyMapping {
  /** The full env-var name to read from process.env. */
  readonly envName: string;
  /** The original (case-preserving) schema path. */
  readonly path: readonly string[];
  /** The leaf descriptor (so callers can coerce values). */
  readonly leaf: SchemaLeaf;
}

export interface DeriveOptions {
  /** Prefix prepended to env var names. Empty string allowed. Default ''. */
  readonly prefix?: string;
  /** Separator between path segments inside the env name. Default '__'. */
  readonly separator?: string;
}

const ACRONYM_RE = /([A-Z]+)([A-Z][a-z])/g;
const CAMEL_RE = /([a-z\d])([A-Z])/g;

/** Convert a single path segment to SCREAMING_SNAKE_CASE. */
function segmentToScreamingSnake(segment: string): string {
  // Replace dots/hyphens; existing underscores are preserved.
  const dehyphenated = segment.replace(/[.-]/g, "_");
  // Acronym split must run before the camel split: see header comment.
  const acronymSplit = dehyphenated.replace(ACRONYM_RE, "$1_$2");
  const camelSplit = acronymSplit.replace(CAMEL_RE, "$1_$2");
  return camelSplit.toUpperCase();
}

/**
 * Derive env-var names for each schema leaf.
 *
 * @param leaves   Flat list from walkSchema().
 * @param options  Prefix and separator. Defaults: prefix='', separator='__'.
 * @returns        One EnvKeyMapping per leaf, in input order.
 */
export function deriveEnvKeys(
  leaves: readonly SchemaLeaf[],
  options?: DeriveOptions,
): EnvKeyMapping[] {
  const prefix = options?.prefix ?? "";
  const separator = options?.separator ?? "__";
  return leaves.map((leaf) => {
    const joined = leaf.path.map(segmentToScreamingSnake).join(separator);
    return {
      envName: `${prefix}${joined}`,
      path: leaf.path,
      leaf,
    };
  });
}
