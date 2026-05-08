import type { z } from "zod";
import { deriveEnvKeys, type EnvKeyMapping } from "../env-keys/derive.js";
import {
  walkSchema,
  type SchemaLeaf,
  type SchemaLeafType,
} from "../env-keys/walker.js";
import { AggregatedConfigError, type ConfigIssue } from "../errors.js";
import { getRuntime } from "../runtime/detect.js";
import type { Runtime, Source } from "../types.js";
import { StandardPriority } from "../types.js";

/**
 * Options for {@link envSource}.
 */
export interface EnvSourceOptions {
  /** Zod schema used to derive expected env keys (input-side walk). */
  readonly schema: z.ZodTypeAny;
  /** Prefix prepended to env var names. Convention: 'APP_'. Default: '' (no prefix; reads bare names). */
  readonly prefix?: string;
  /** Separator between path segments inside the env name. Default: '__'. */
  readonly separator?: string;
  /** Optional. Custom runtime override (defaults to detected runtime). */
  readonly runtime?: Runtime;
  /** Optional. Source name for diagnostics. Default: 'env'. */
  readonly name?: string;
  /** Optional. Priority. Default: StandardPriority.env (50). */
  readonly priority?: number;
  /**
   * Optional. When true, console.warn lists env vars matching the prefix that
   * aren't in the derived schema keys. Default: process.env.NODE_ENV !== 'production'.
   *
   * Has no effect when `prefix` is empty (the default), since unprefixed env
   * vars cannot be distinguished from unrelated environment state.
   */
  readonly warnOnUnknown?: boolean;
}

type PrimitiveLeafType = Exclude<SchemaLeafType, "array">;

type CoerceOk = { readonly ok: true; readonly value: unknown };
type CoerceErr = { readonly ok: false; readonly message: string };
type CoerceResult = CoerceOk | CoerceErr;

const TRUE_FORMS = new Set(["true", "1", "yes", "on"]);
const FALSE_FORMS = new Set(["false", "0", "no", "off", ""]);
const ACCEPTED_BOOL_MSG = "true/false/1/0/yes/no/on/off";

function coercePrimitive(
  raw: string,
  type: PrimitiveLeafType,
  values: readonly (string | number | boolean)[] | undefined,
): CoerceResult {
  switch (type) {
    case "string":
      return { ok: true, value: raw };
    case "number": {
      const trimmed = raw.trim();
      if (trimmed === "") {
        return { ok: false, message: `expected number, got '${raw}'` };
      }
      const n = Number(trimmed);
      if (Number.isNaN(n)) {
        return { ok: false, message: `expected number, got '${raw}'` };
      }
      return { ok: true, value: n };
    }
    case "boolean": {
      // Trim to match number's tolerance: APP_FLAG='true ' is reasonable
      // shell behaviour and shouldn't fail the way 'maybe' does.
      const lower = raw.trim().toLowerCase();
      if (TRUE_FORMS.has(lower)) return { ok: true, value: true };
      if (FALSE_FORMS.has(lower)) return { ok: true, value: false };
      return {
        ok: false,
        message: `expected boolean (${ACCEPTED_BOOL_MSG}), got '${raw}'`,
      };
    }
    case "enum":
    case "literal": {
      const allowed = values ?? [];
      // Compare as strings; if any allowed value is numeric, also accept the
      // numeric string and coerce to that number type.
      for (const v of allowed) {
        if (typeof v === "number") {
          if (raw === String(v)) return { ok: true, value: v };
        } else if (typeof v === "boolean") {
          if (raw === String(v)) return { ok: true, value: v };
        } else if (raw === v) {
          return { ok: true, value: v };
        }
      }
      return {
        ok: false,
        message: `expected one of [${allowed.join(", ")}], got '${raw}'`,
      };
    }
  }
}

function coerceArray(raw: string, leaf: SchemaLeaf): CoerceResult {
  const itemType = leaf.itemType;
  if (itemType === undefined) {
    // Defensive: walker always sets itemType for inputType==='array'.
    return { ok: false, message: "array leaf missing itemType (internal)" };
  }
  if (raw === "") {
    return { ok: true, value: [] };
  }
  const parts = raw.split(",").map((s) => s.trim());
  const out: unknown[] = [];
  const bad: string[] = [];
  for (const part of parts) {
    const r = coercePrimitive(part, itemType, leaf.itemValues);
    if (r.ok) {
      out.push(r.value);
    } else {
      bad.push(part);
    }
  }
  if (bad.length > 0) {
    return {
      ok: false,
      message: `expected array of ${itemType}, item(s) [${bad.join(", ")}] failed coercion`,
    };
  }
  return { ok: true, value: out };
}

function coerceLeaf(raw: string, leaf: SchemaLeaf): CoerceResult {
  if (leaf.inputType === "array") {
    return coerceArray(raw, leaf);
  }
  return coercePrimitive(raw, leaf.inputType, leaf.values);
}

function assignPath(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  if (path.length === 0) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as string;
    const existing = cur[key];
    if (
      existing === undefined ||
      existing === null ||
      typeof existing !== "object" ||
      Array.isArray(existing)
    ) {
      const next: Record<string, unknown> = {};
      cur[key] = next;
      cur = next;
    } else {
      cur = existing as Record<string, unknown>;
    }
  }
  cur[path[path.length - 1] as string] = value;
}

function defaultWarnOnUnknown(): boolean {
  // process is not always defined on edge runtimes — guard the access.
  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env?.NODE_ENV !== "production";
}

/**
 * Build a {@link Source} that reads configuration from environment
 * variables, coerced into the shape demanded by the supplied schema.
 *
 * The schema is walked at construction time to derive the set of
 * expected env-var names — `prefix` + path joined by `separator`. Each
 * leaf is coerced from its string form (`number`, `boolean`, enum/literal,
 * or comma-separated array). Coercion failures are aggregated into a
 * single {@link AggregatedConfigError}.
 *
 * Unsupported schema constructs (e.g. transforms, lazy) raise
 * {@link UnsupportedSchemaError} synchronously from this call.
 *
 * @example
 * ```ts
 * envSource({ schema, prefix: 'APP_' });
 * // PORT under `port` is read from APP_PORT
 * // server.host is read from APP_SERVER__HOST
 * ```
 *
 * @throws {@link UnsupportedSchemaError} for unsupported schema nodes.
 */
export function envSource(options: EnvSourceOptions): Source {
  const {
    schema,
    prefix = "",
    separator = "__",
    runtime: runtimeOverride,
    name = "env",
    priority = StandardPriority.env,
    warnOnUnknown,
  } = options;

  // Eager: walk schema + derive mappings at construction time so
  // UnsupportedSchemaError surfaces while the caller is still on the stack.
  const leaves = walkSchema(schema);
  const mappings: readonly EnvKeyMapping[] = deriveEnvKeys(leaves, {
    prefix,
    separator,
  });
  const expectedNames = new Set(mappings.map((m) => m.envName));

  const shouldWarn = warnOnUnknown ?? defaultWarnOnUnknown();

  return {
    name,
    priority,
    async read(): Promise<unknown> {
      const runtime = await getRuntime(runtimeOverride);
      const issues: ConfigIssue[] = [];
      const root: Record<string, unknown> = {};
      let assigned = 0;

      for (const mapping of mappings) {
        const raw = runtime.readEnv(mapping.envName);
        if (raw === undefined) continue;
        const r = coerceLeaf(raw, mapping.leaf);
        if (r.ok) {
          assignPath(root, mapping.path, r.value);
          assigned++;
        } else {
          issues.push({
            path: mapping.path,
            message: r.message,
            source: "env",
            code: "env_coerce",
          });
        }
      }

      if (shouldWarn && prefix !== "") {
        const present = runtime.listEnv(prefix);
        const unknown = Object.keys(present).filter(
          (k) => !expectedNames.has(k),
        );
        if (unknown.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `confetti envSource: ignored ${unknown.length} unknown env var(s) matching prefix '${prefix}': ${unknown.join(", ")}`,
          );
        }
      }

      if (issues.length > 0) {
        throw new AggregatedConfigError(issues);
      }

      return assigned === 0 ? undefined : root;
    },
  };
}
