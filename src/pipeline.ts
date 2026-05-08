import { z } from "zod";
import { diff as computeDiff } from "./diff.js";
import { walkSchema } from "./env-keys/walker.js";
import { AggregatedConfigError, type ConfigIssue } from "./errors.js";
import { deepMerge, type MergeLayer } from "./merge.js";
import { Subscribers } from "./subscribers.js";
import type {
  Parser,
  ReloadHandler,
  ErrorHandler,
  Runtime,
  Source,
  Unwatch,
} from "./types.js";

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
   * NOTE: the happy-path pipeline does not own parser routing — fileSource
   * accepts its own `parsers` registry directly. This option is declared
   * on the API surface for forward compatibility. For now it is accepted
   * and ignored; pass parsers via fileSource({ parsers }) instead. See
   * `src/sources/file.ts` for the actual consumer.
   */
  readonly parsers?: Record<string, Parser>;
  /**
   * Optional. Custom runtime override (defaults to detected).
   *
   * NOTE: same forward-looking shape as `parsers` — sources own their own
   * runtime injection (envSource, fileSource accept a `runtime` option).
   */
  readonly runtime?: Runtime;
}

/**
 * Loaded, validated, frozen configuration with reload + subscriptions.
 *
 * `current` is a getter — the snapshot reference is replaced on every
 * successful reload.
 */
export interface Config<T> {
  /** Frozen current snapshot — getter returns the latest after reload. */
  readonly current: T;
  /** Programmatically re-run the pipeline. Returns the new snapshot. */
  reload(): Promise<T>;
  /** Subscribe to successful reloads. Handlers run in registration order. */
  onChange(handler: ReloadHandler): Unwatch;
  /** Subscribe to subscriber/source errors. Handlers run in registration order. */
  onError(handler: ErrorHandler): Unwatch;
  /** Tear down all watchers + subscribers. After close(), reload() is a no-op. */
  close(): Promise<void>;
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
 *
 * After the initial load, every source that exposes `watch` is subscribed
 * with a notify callback that triggers `reload()`. Concurrent notifications
 * are coalesced via a single-pending pattern (latest-wins).
 */
export async function defineConfig<T extends z.ZodTypeAny>(
  options: DefineConfigOptions<T>,
): Promise<Config<z.output<T>>> {
  // Eager schema walk — surfaces UnsupportedSchemaError synchronously
  // before any I/O. We discard the leaves; envSource owns its own walk.
  walkSchema(options.schema);

  type Snapshot = z.output<T>;
  const subs = new Subscribers();
  let current: Snapshot = await runPipeline<T>(options);
  let closed = false;
  let inflight: Promise<Snapshot> | null = null;
  let pending = false;
  const sourceUnwatches: Unwatch[] = [];

  // Wire watchers: for every source with `watch`, subscribe a notify
  // callback that triggers reload. The reload uses the standard reload()
  // path so onChange + onError fire normally. The second arg is an
  // onError bridge so async startup failures from the source land in
  // Config.onError(err, source.name) instead of being swallowed.
  for (const source of options.sources) {
    if (typeof source.watch === "function") {
      try {
        const un = source.watch(
          () => {
            if (closed) return;
            // Fire-and-forget. Errors are already routed to onError inside
            // triggerReload(); we don't want to surface them here.
            void triggerReload().catch(() => {});
          },
          (err) => {
            subs.notifyError(err, source.name);
          },
        );
        sourceUnwatches.push(un);
      } catch (err) {
        // Source.watch threw synchronously at subscription time — route
        // to onError with the source name and continue.
        subs.notifyError(err, source.name);
      }
    }
  }

  async function triggerReload(): Promise<Snapshot> {
    if (closed) return current;
    if (inflight) {
      pending = true;
      return inflight;
    }
    inflight = (async () => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const result = await runReloadOnce();
          if (!pending) return result;
          pending = false;
          // loop again — newer notify(s) arrived during the last reload
        }
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function runReloadOnce(): Promise<Snapshot> {
    let next: Snapshot;
    try {
      next = await runPipeline<T>(options);
    } catch (err) {
      // Both schema-parse failure (AggregatedConfigError) and source-read
      // rejection currently attribute to 'merged': from outside Promise.all
      // we cannot tell which source's read() rejected. A future task could
      // tag the Promise.all index back to source.name; for now we keep the
      // attribution conservative.
      subs.notifyError(err, "merged");
      throw err;
    }
    const before = current;
    current = next;
    const d = computeDiff(before, next);
    await subs.notifyChange(next, d);
    return next;
  }

  const config: Config<Snapshot> = {
    get current(): Snapshot {
      return current;
    },
    async reload(): Promise<Snapshot> {
      if (closed) return current;
      return triggerReload();
    },
    onChange(handler: ReloadHandler): Unwatch {
      return subs.onChange(handler);
    },
    onError(handler: ErrorHandler): Unwatch {
      return subs.onError(handler);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // Drop subscribers FIRST so an in-flight reload that completes
      // mid-teardown doesn't fire onChange after the user called close().
      // Its notifyChange becomes a no-op against an empty handler list.
      subs.clear();
      // Wait for any in-flight reload to finish so close() resolves only
      // after the pipeline is quiescent. Errors are swallowed — the
      // inflight cycle already routed to (now-empty) onError.
      if (inflight) {
        try {
          await inflight;
        } catch {
          // intentional: close must not throw
        }
      }
      // Tear down every source unwatcher in parallel. Errors are
      // swallowed — close() must be tolerant.
      const teardowns: Array<Promise<void>> = [];
      for (const un of sourceUnwatches) {
        try {
          const r = un();
          if (r && typeof (r as Promise<void>).catch === "function") {
            teardowns.push((r as Promise<void>).catch(() => {}));
          }
        } catch {
          // intentional: close must not throw
        }
      }
      await Promise.all(teardowns);
      sourceUnwatches.length = 0;
    },
  };

  return config;
}

/**
 * Run the load → merge → validate → freeze pipeline once. Used both for
 * the initial load and for every reload.
 */
async function runPipeline<T extends z.ZodTypeAny>(
  options: DefineConfigOptions<T>,
): Promise<z.output<T>> {
  // Load every source in parallel. A rejection from any source aborts
  // the load — we deliberately do NOT aggregate source-load errors
  // (per spec §2 SC3 — aggregation is for schema validation issues).
  const rawValues = await Promise.all(options.sources.map((s) => s.read()));

  // Pair sources with their loaded values and sort ascending by priority.
  // Stable sort: ties resolved by original declaration order.
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

  // Build MergeLayer[] in low → high priority order. Sources that
  // contributed `undefined` are filtered (per merge.ts contract,
  // undefined means "no contribution"; filtering avoids redundant work).
  const layers: MergeLayer[] = [];
  for (const entry of paired) {
    if (entry.value === undefined) continue;
    const layer: MergeLayer =
      entry.source.arrayMerge !== undefined
        ? {
            value: entry.value,
            arrayMerge: entry.source.arrayMerge,
            source: entry.source.name,
          }
        : { value: entry.value, source: entry.source.name };
    layers.push(layer);
  }

  // Deep-merge.
  const { value: merged, provenance } = deepMerge(layers);

  // Schema-validate. Wrap ZodError into AggregatedConfigError so
  // callers always see a single error type for validation failures.
  let parsed: z.output<T>;
  try {
    parsed = options.schema.parse(merged);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues: ConfigIssue[] = err.issues.map((issue) => {
        const path = issue.path.map(String);
        const key = path.join(".");
        // Look up the contributing source. Falls back to 'merged' for
        // structural failures (absent required keys, type-mismatch at an
        // object boundary) where no leaf was ever written by any layer.
        const source = provenance.get(key) ?? "merged";
        return {
          path,
          message: issue.message,
          source,
          code: issue.code,
        };
      });
      throw new AggregatedConfigError(issues, { cause: err });
    }
    throw err;
  }

  // Recursive freeze and return.
  return deepFreeze(parsed);
}

/**
 * Recursively freeze plain objects and arrays in-place. Returns the
 * same reference (typed identically). Skips primitives and already-frozen
 * / non-extensible values (including class instances we might not own).
 */
function deepFreeze<U>(value: U): U {
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
