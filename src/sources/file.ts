import { ParseError } from "../errors.js";
import type { ParserRegistry } from "../parsers/registry.js";
import { defaultRegistry, getParser } from "../parsers/registry.js";
import { getRuntime } from "../runtime/detect.js";
import type { Runtime, Source, Unwatch } from "../types.js";
import { StandardPriority } from "../types.js";
import { watchFile, type WatcherOptions } from "../watcher/index.js";

export interface FileSourceOptions {
  /** Path to the config file. Resolved relative to process.cwd() unless absolute. */
  readonly path: string;
  /** Optional. Force a specific format/parser by registry key (e.g. 'yaml'). Overrides extension detection. */
  readonly format?: string;
  /** Optional. Custom runtime override (defaults to detected runtime). */
  readonly runtime?: Runtime;
  /** Optional. Custom parser registry (defaults to defaultRegistry()). */
  readonly parsers?: ParserRegistry;
  /** Optional. Override source name (default: `file:${basename}`). */
  readonly name?: string;
  /** Optional. Override priority (default: StandardPriority.file = 25). */
  readonly priority?: number;
  /** Optional. arrayMerge policy. Default: 'replace'. */
  readonly arrayMerge?: "replace" | "concat";
  /** Optional. If true, missing file is treated as empty config (read() resolves undefined) instead of throwing. Default: false. */
  readonly optional?: boolean;
  /**
   * Optional. Watcher tuning passed through to {@link watchFile}.
   * Currently exposes `debounceMs`, `resolveSymlinks`, and `onError`.
   * If omitted, defaults are used.
   */
  readonly watch?: Pick<
    WatcherOptions,
    "debounceMs" | "resolveSymlinks" | "onError"
  >;
}

/** Manual posix basename — avoids importing node:path so this module stays runtime-agnostic. */
function posixBasename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/** Extract extension (lowercased, no leading dot) from a path. Returns "" if none. */
function extOf(p: string): string {
  const base = posixBasename(p);
  const i = base.lastIndexOf(".");
  if (i <= 0) return ""; // no dot, or leading-dot dotfile (".env")
  return base.slice(i + 1).toLowerCase();
}

function isMissingFileError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "ENOENT") return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.includes("No such file");
}

export function fileSource(options: FileSourceOptions): Source {
  const {
    path,
    format,
    runtime: runtimeOverride,
    parsers,
    name,
    priority,
    arrayMerge,
    optional,
    watch: watchOptions,
  } = options;

  const formatKey = format ?? extOf(path);
  const registry: ParserRegistry = parsers ?? defaultRegistry();
  const sourceName = name ?? `file:${posixBasename(path)}`;
  const sourcePriority = priority ?? StandardPriority.file;

  // Resolve parser eagerly so unknown-format errors surface at construction
  // time when callers are still on the call stack — matches the spec
  // "unknown extensions throw a clear error" expectation.
  const parser = getParser(registry, formatKey);

  const source: Source & { arrayMerge?: "replace" | "concat" } = {
    name: sourceName,
    priority: sourcePriority,
    async read(): Promise<unknown> {
      const runtime = await getRuntime(runtimeOverride);
      let raw: string;
      try {
        raw = await runtime.readFile(path);
      } catch (err) {
        if (optional === true && isMissingFileError(err)) {
          return undefined;
        }
        throw err;
      }
      try {
        return parser.parse(raw);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new ParseError(
          `confetti: failed to parse '${path}' as ${formatKey}: ${reason}`,
          { sourcePath: path, parserName: formatKey, cause },
        );
      }
    },
    watch(notify: () => void): Unwatch {
      // watchFile is async (it resolves symlinks and detects runtime), but
      // Source.watch is synchronous. We start the watcher eagerly and wrap
      // the eventual Unwatch in a closure that disposes once it resolves
      // (or queues a disposal flag if Unwatch lands first).
      let disposed = false;
      let innerUnwatch: Unwatch | undefined;
      const startError = (err: unknown) => {
        watchOptions?.onError?.(err);
      };
      void watchFile(path, notify, {
        ...(watchOptions?.debounceMs !== undefined
          ? { debounceMs: watchOptions.debounceMs }
          : {}),
        ...(watchOptions?.resolveSymlinks !== undefined
          ? { resolveSymlinks: watchOptions.resolveSymlinks }
          : {}),
        ...(watchOptions?.onError !== undefined
          ? { onError: watchOptions.onError }
          : {}),
        ...(runtimeOverride !== undefined ? { runtime: runtimeOverride } : {}),
      })
        .then((un) => {
          if (disposed) {
            const r = un();
            if (r && typeof (r as Promise<void>).catch === "function") {
              (r as Promise<void>).catch(startError);
            }
          } else {
            innerUnwatch = un;
          }
        })
        .catch(startError);
      return () => {
        disposed = true;
        if (innerUnwatch) {
          const r = innerUnwatch();
          innerUnwatch = undefined;
          if (r && typeof (r as Promise<void>).catch === "function") {
            (r as Promise<void>).catch(startError);
          }
        }
      };
    },
  };

  if (arrayMerge !== undefined) {
    source.arrayMerge = arrayMerge;
  }

  return source;
}
