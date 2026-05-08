import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectTypeOf } from "expect-type";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { isUnsupportedSchemaError } from "./env-keys/unsupported.js";
import {
  AggregatedConfigError,
  isAggregatedConfigError,
  isParseError,
} from "./errors.js";
import { defineConfig } from "./pipeline.js";
import { defaultsSource } from "./sources/defaults.js";
import { envSource } from "./sources/env.js";
import { fileSource } from "./sources/file.js";
import { flagsSource } from "./sources/flags.js";
import { overrideSource } from "./sources/override.js";
import type { Runtime } from "./types.js";

/**
 * Build a fake Runtime backed by a fixed env map. Mirrors the helper
 * in env.test.ts — reproduced here so the pipeline tests don't reach
 * across test files.
 */
function fakeRuntime(env: Record<string, string>): Runtime {
  return {
    async readFile(): Promise<string> {
      throw new Error("readFile not used in pipeline env tests");
    },
    readEnv: (key: string) => env[key],
    listEnv: (prefix: string) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        if (prefix === "" || k.startsWith(prefix)) out[k] = v;
      }
      return out;
    },
  };
}

describe("defineConfig: happy path", () => {
  it("returns the override value when defaults + override both set the same key", async () => {
    const schema = z.object({ port: z.number() });
    const result = await defineConfig({
      schema,
      sources: [defaultsSource({ port: 3000 }), overrideSource({ port: 5000 })],
    });
    expect(result.current.port).toBe(5000);
  });

  it("falls back to defaults when no other layer sets the key", async () => {
    const schema = z.object({ port: z.number() });
    const result = await defineConfig({
      schema,
      sources: [defaultsSource({ port: 3000 })],
    });
    expect(result.current.port).toBe(3000);
  });

  it("ignores caller-supplied source order — sorts by priority", async () => {
    const schema = z.object({ port: z.number() });
    // Override declared first; defaults declared last. Expected: override wins.
    const result = await defineConfig({
      schema,
      sources: [overrideSource({ port: 5000 }), defaultsSource({ port: 3000 })],
    });
    expect(result.current.port).toBe(5000);
  });
});

describe("defineConfig: 5-layer precedence (SC2)", () => {
  const schema = z.object({ key: z.string() });

  it("override wins when present at top of stack", async () => {
    const result = await defineConfig({
      schema,
      sources: [
        defaultsSource({ key: "default" }),
        flagsSource({ key: "flag" }),
        envSource({
          schema,
          prefix: "APP_",
          runtime: fakeRuntime({ APP_KEY: "env" }),
          warnOnUnknown: false,
        }),
        overrideSource({ key: "override" }),
      ],
    });
    expect(result.current.key).toBe("override");
  });

  it("flag wins when override absent", async () => {
    const result = await defineConfig({
      schema,
      sources: [
        defaultsSource({ key: "default" }),
        flagsSource({ key: "flag" }),
        envSource({
          schema,
          prefix: "APP_",
          runtime: fakeRuntime({ APP_KEY: "env" }),
          warnOnUnknown: false,
        }),
      ],
    });
    expect(result.current.key).toBe("flag");
  });

  it("env wins when override + flag absent", async () => {
    const result = await defineConfig({
      schema,
      sources: [
        defaultsSource({ key: "default" }),
        envSource({
          schema,
          prefix: "APP_",
          runtime: fakeRuntime({ APP_KEY: "env" }),
          warnOnUnknown: false,
        }),
      ],
    });
    expect(result.current.key).toBe("env");
  });

  it("file wins when override + flag + env absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "confetti-pipeline-"));
    try {
      const p = join(dir, "config.json");
      await writeFile(p, JSON.stringify({ key: "file" }), "utf8");
      const result = await defineConfig({
        schema,
        sources: [defaultsSource({ key: "default" }), fileSource({ path: p })],
      });
      expect(result.current.key).toBe("file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("default wins when only defaults provided", async () => {
    const result = await defineConfig({
      schema,
      sources: [defaultsSource({ key: "default" })],
    });
    expect(result.current.key).toBe("default");
  });

  it("full 5-layer stack: override beats all others", async () => {
    const dir = await mkdtemp(join(tmpdir(), "confetti-pipeline-"));
    try {
      const p = join(dir, "config.json");
      await writeFile(p, JSON.stringify({ key: "file" }), "utf8");
      const result = await defineConfig({
        schema,
        sources: [
          defaultsSource({ key: "default" }),
          fileSource({ path: p }),
          envSource({
            schema,
            prefix: "APP_",
            runtime: fakeRuntime({ APP_KEY: "env" }),
            warnOnUnknown: false,
          }),
          flagsSource({ key: "flag" }),
          overrideSource({ key: "override" }),
        ],
      });
      expect(result.current.key).toBe("override");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("defineConfig: frozen result (SC1)", () => {
  it("freezes the top-level object", async () => {
    const schema = z.object({ port: z.number() });
    const result = await defineConfig({
      schema,
      sources: [overrideSource({ port: 5000 })],
    });
    expect(Object.isFrozen(result.current)).toBe(true);
  });

  it("freezes nested objects recursively", async () => {
    const schema = z.object({
      server: z.object({ port: z.number(), host: z.string() }),
    });
    const result = await defineConfig({
      schema,
      sources: [overrideSource({ server: { port: 5000, host: "localhost" } })],
    });
    expect(Object.isFrozen(result.current)).toBe(true);
    expect(Object.isFrozen(result.current.server)).toBe(true);
  });

  it("freezes nested arrays", async () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const result = await defineConfig({
      schema,
      sources: [overrideSource({ tags: ["a", "b", "c"] })],
    });
    expect(Object.isFrozen(result.current.tags)).toBe(true);
  });

  // The class-instance branch in deepFreeze (Date/Map/Set/user classes) is
  // unreachable through the v0.1 supported schema set — z.date(), z.unknown(),
  // z.any() etc. are all rejected by the walker. The guard exists as
  // defensive code for future schema types; testing it would require either
  // exporting deepFreeze or introducing an unsupported construct.
});

describe("defineConfig: type narrowing (SC1)", () => {
  it("Config<T>.current matches z.output<typeof schema>", async () => {
    const schema = z.object({ port: z.number(), name: z.string() });
    const result = await defineConfig({
      schema,
      sources: [overrideSource({ port: 5000, name: "alice" })],
    });
    expectTypeOf(result.current).toEqualTypeOf<{
      port: number;
      name: string;
    }>();
  });
});

describe("defineConfig: schema parse failure aggregates (SC3)", () => {
  it("throws AggregatedConfigError when validation fails", async () => {
    const schema = z.object({ port: z.number() });
    await expect(
      defineConfig({
        schema,
        sources: [overrideSource({ port: "not a number" })],
      }),
    ).rejects.toBeInstanceOf(AggregatedConfigError);
  });

  it("each issue carries the contributing source and a Zod code", async () => {
    const schema = z.object({ port: z.number() });
    let caught: unknown;
    try {
      await defineConfig({
        schema,
        sources: [overrideSource({ port: "not a number" })],
      });
    } catch (e) {
      caught = e;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    if (!isAggregatedConfigError(caught)) return; // narrow for TS
    expect(caught.issues.length).toBeGreaterThan(0);
    const first = caught.issues[0];
    // override supplied the bad value, so the issue is attributed to it.
    expect(first?.source).toBe("override");
    expect(first?.code).toBe("invalid_type");
    expect(first?.path).toEqual(["port"]);
  });

  it("falls back to source='merged' for structural failures (missing required keys)", async () => {
    const schema = z.object({
      port: z.number(),
      name: z.string(),
    });
    let caught: unknown;
    try {
      // No layer contributes either key — these are structural failures.
      await defineConfig({
        schema,
        sources: [overrideSource({})],
      });
    } catch (e) {
      caught = e;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    if (!isAggregatedConfigError(caught)) return;
    for (const issue of caught.issues) {
      expect(issue.source).toBe("merged");
    }
  });

  it("attributes issues to the actual contributing layer across multiple sources", async () => {
    const schema = z.object({
      port: z.number(),
      host: z.string(),
    });
    let caught: unknown;
    try {
      // env contributes a bad port (string after coercion failure path is
      // owned by envSource itself; here we hand env a literal value via
      // a hand-built source so we can drive the pipeline directly).
      await defineConfig({
        schema,
        sources: [
          {
            name: "file",
            priority: 25,
            read: () => Promise.resolve({ host: 12345 }), // wrong type from file
          },
          {
            name: "env",
            priority: 50,
            read: () => Promise.resolve({ port: "not-a-number" }), // wrong type from env
          },
        ],
      });
    } catch (e) {
      caught = e;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    if (!isAggregatedConfigError(caught)) return;
    const byPath = new Map(
      caught.issues.map((i) => [i.path.join("."), i.source]),
    );
    expect(byPath.get("port")).toBe("env");
    expect(byPath.get("host")).toBe("file");
  });

  it("attributes issues to user-defined source names", async () => {
    const schema = z.object({ port: z.number() });
    let caught: unknown;
    try {
      await defineConfig({
        schema,
        sources: [
          {
            name: "aws-secrets",
            priority: 75,
            read: () => Promise.resolve({ port: "bogus" }),
          },
        ],
      });
    } catch (e) {
      caught = e;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    if (!isAggregatedConfigError(caught)) return;
    expect(caught.issues[0]?.source).toBe("aws-secrets");
  });

  it("aggregates multiple Zod issues into one error", async () => {
    const schema = z.object({
      port: z.number(),
      name: z.string(),
    });
    let caught: unknown;
    try {
      await defineConfig({
        schema,
        sources: [overrideSource({})],
      });
    } catch (e) {
      caught = e;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    if (!isAggregatedConfigError(caught)) return;
    expect(caught.issues.length).toBe(2);
    const paths = caught.issues.map((i) => i.path.join("."));
    expect(paths.sort()).toEqual(["name", "port"]);
  });

  it("preserves the underlying ZodError as .cause", async () => {
    const schema = z.object({ port: z.number() });
    let caught: unknown;
    try {
      await defineConfig({
        schema,
        sources: [overrideSource({ port: "x" })],
      });
    } catch (e) {
      caught = e;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    if (!isAggregatedConfigError(caught)) return;
    expect(caught.cause).toBeInstanceOf(z.ZodError);
  });
});

describe("defineConfig: UnsupportedSchemaError propagates eagerly", () => {
  it("rejects schemas with .transform()", async () => {
    const schema = z.object({
      port: z.number().transform((n) => n + 1),
    });
    let caught: unknown;
    try {
      await defineConfig({
        schema,
        sources: [overrideSource({ port: 5000 })],
      });
    } catch (e) {
      caught = e;
    }
    expect(isUnsupportedSchemaError(caught)).toBe(true);
    expect(isAggregatedConfigError(caught)).toBe(false);
  });
});

describe("defineConfig: undefined source contribution is skipped", () => {
  it("flagsSource(undefined) doesn't crash the merge", async () => {
    const schema = z.object({ port: z.number() });
    const result = await defineConfig({
      schema,
      sources: [defaultsSource({ port: 3000 }), flagsSource(undefined)],
    });
    expect(result.current.port).toBe(3000);
  });

  it("multiple undefined sources skipped", async () => {
    const schema = z.object({ port: z.number() });
    const result = await defineConfig({
      schema,
      sources: [
        defaultsSource({ port: 3000 }),
        flagsSource(undefined),
        overrideSource(undefined),
      ],
    });
    expect(result.current.port).toBe(3000);
  });
});

describe("defineConfig: source-level errors propagate", () => {
  it("fileSource ENOENT (non-optional) propagates as the original error", async () => {
    const schema = z.object({ port: z.number() });
    let caught: unknown;
    try {
      await defineConfig({
        schema,
        sources: [
          defaultsSource({ port: 3000 }),
          fileSource({ path: "/nonexistent/path/to/file.json" }),
        ],
      });
    } catch (e) {
      caught = e;
    }
    // Not aggregated — raw ENOENT-style error.
    expect(isAggregatedConfigError(caught)).toBe(false);
    expect(caught).toBeInstanceOf(Error);
  });

  it("fileSource parse error propagates as ParseError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "confetti-pipeline-"));
    try {
      const p = join(dir, "bad.json");
      await writeFile(p, "{not valid json", "utf8");
      const schema = z.object({ port: z.number() });
      let caught: unknown;
      try {
        await defineConfig({
          schema,
          sources: [fileSource({ path: p })],
        });
      } catch (e) {
        caught = e;
      }
      expect(isParseError(caught)).toBe(true);
      expect(isAggregatedConfigError(caught)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("envSource AggregatedConfigError propagates with source='env' (not 'merged')", async () => {
    const schema = z.object({ port: z.number() });
    let caught: unknown;
    try {
      await defineConfig({
        schema,
        sources: [
          envSource({
            schema,
            prefix: "APP_",
            runtime: fakeRuntime({ APP_PORT: "abc" }), // bad coercion
            warnOnUnknown: false,
          }),
        ],
      });
    } catch (e) {
      caught = e;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    if (!isAggregatedConfigError(caught)) return;
    expect(caught.issues[0]?.source).toBe("env");
  });
});

describe("defineConfig: arrayMerge concat policy", () => {
  it("concat policy on the higher-priority source appends to lower's array", async () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const result = await defineConfig({
      schema,
      sources: [
        defaultsSource({ tags: ["a", "b"] }),
        // Build an override-style source by hand so we can set arrayMerge.
        {
          name: "override",
          priority: 100,
          arrayMerge: "concat",
          read: () => Promise.resolve({ tags: ["c"] }),
        },
      ],
    });
    expect(result.current.tags).toEqual(["a", "b", "c"]);
  });
});

describe("defineConfig: empty / minimal sources", () => {
  it("empty sources array uses Zod schema defaults", async () => {
    // Top-level default required: when no source contributes a value the
    // merged tree is `undefined`, and Zod's parse() of `undefined` against
    // a bare ZodObject errors. `.default({})` lets the schema produce its
    // own root, which then populates each leaf's default.
    const schema = z
      .object({
        port: z.number().default(3000),
        name: z.string().default("app"),
      })
      .default({});
    const result = await defineConfig({
      schema,
      sources: [],
    });
    expect(result.current).toEqual({ port: 3000, name: "app" });
    expect(Object.isFrozen(result.current)).toBe(true);
  });
});

describe("defineConfig: real fileSource integration", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "confetti-pipeline-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads + parses a JSON file via fileSource", async () => {
    const p = join(dir, "config.json");
    await writeFile(
      p,
      JSON.stringify({ port: 8080, debug: true, name: "fromfile" }),
      "utf8",
    );
    const schema = z.object({
      port: z.number(),
      debug: z.boolean(),
      name: z.string(),
    });
    const result = await defineConfig({
      schema,
      sources: [fileSource({ path: p })],
    });
    expect(result.current).toEqual({
      port: 8080,
      debug: true,
      name: "fromfile",
    });
  });
});

describe("public exports smoke", () => {
  it("re-exports defineConfig and source factories from index.js", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.defineConfig).toBe("function");
    expect(typeof mod.overrideSource).toBe("function");
    expect(typeof mod.defaultsSource).toBe("function");
    expect(typeof mod.flagsSource).toBe("function");
    expect(typeof mod.fileSource).toBe("function");
    expect(typeof mod.envSource).toBe("function");
    expect(typeof mod.AggregatedConfigError).toBe("function");
    expect(typeof mod.isAggregatedConfigError).toBe("function");
    expect(typeof mod.ParseError).toBe("function");
    expect(typeof mod.isParseError).toBe("function");
    expect(typeof mod.UnsupportedSchemaError).toBe("function");
    expect(typeof mod.isUnsupportedSchemaError).toBe("function");
    expect(typeof mod.StandardPriority).toBe("object");
    expect(typeof mod.diff).toBe("function");
  });
});

describe("defineConfig: programmatic reload", () => {
  it("reload() re-runs sources and returns the new snapshot", async () => {
    const schema = z.object({ port: z.number() });
    let value = 3000;
    const dynamic = {
      name: "dynamic",
      priority: 100,
      read: () => Promise.resolve({ port: value }),
    };
    const config = await defineConfig({ schema, sources: [dynamic] });
    expect(config.current.port).toBe(3000);
    value = 8080;
    const next = await config.reload();
    expect(next.port).toBe(8080);
    expect(config.current.port).toBe(8080);
    await config.close();
  });

  it("reload() updates the current getter on success", async () => {
    const schema = z.object({ key: z.string() });
    let value = "first";
    const config = await defineConfig({
      schema,
      sources: [
        {
          name: "test",
          priority: 100,
          read: () => Promise.resolve({ key: value }),
        },
      ],
    });
    expect(config.current.key).toBe("first");
    value = "second";
    await config.reload();
    expect(config.current.key).toBe("second");
    await config.close();
  });
});

describe("defineConfig: onChange handler dispatch", () => {
  it("invokes onChange handlers in registration order with diff", async () => {
    const schema = z.object({ port: z.number() });
    let value = 3000;
    const config = await defineConfig({
      schema,
      sources: [
        {
          name: "test",
          priority: 100,
          read: () => Promise.resolve({ port: value }),
        },
      ],
    });
    const events: string[] = [];
    let capturedDiff: unknown = null;
    config.onChange((next, d) => {
      events.push(`a:${(next as { port: number }).port}`);
      capturedDiff = d;
    });
    config.onChange((next) => {
      events.push(`b:${(next as { port: number }).port}`);
    });
    value = 8080;
    await config.reload();
    expect(events).toEqual(["a:8080", "b:8080"]);
    expect(capturedDiff).toEqual([
      { path: ["port"], before: 3000, after: 8080 },
    ]);
    await config.close();
  });

  it("handler throw is routed to onError(err, 'merged') and subsequent handlers still run", async () => {
    const schema = z.object({ port: z.number() });
    let value = 3000;
    const config = await defineConfig({
      schema,
      sources: [
        {
          name: "test",
          priority: 100,
          read: () => Promise.resolve({ port: value }),
        },
      ],
    });
    const errs: Array<{ err: unknown; source: string }> = [];
    const seen: string[] = [];
    config.onError((err, source) => {
      errs.push({ err, source });
    });
    config.onChange(() => {
      throw new Error("handler-boom");
    });
    config.onChange(() => {
      seen.push("after");
    });
    value = 8080;
    await config.reload();
    expect(seen).toEqual(["after"]);
    expect(errs.length).toBe(1);
    const first = errs[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.source).toBe("merged");
    expect((first.err as Error).message).toBe("handler-boom");
    await config.close();
  });
});

describe("defineConfig: reload schema-fail", () => {
  it("throws AggregatedConfigError; current unchanged; onError fires with 'merged'", async () => {
    const schema = z.object({ port: z.number() });
    let value: unknown = 3000;
    const config = await defineConfig({
      schema,
      sources: [
        {
          name: "test",
          priority: 100,
          read: () => Promise.resolve({ port: value }),
        },
      ],
    });
    const errs: Array<{ err: unknown; source: string }> = [];
    const changes: number[] = [];
    config.onError((err, source) => {
      errs.push({ err, source });
    });
    config.onChange((next) => {
      changes.push((next as { port: number }).port);
    });
    value = "not-a-number";
    await expect(config.reload()).rejects.toBeInstanceOf(AggregatedConfigError);
    // current is unchanged
    expect(config.current.port).toBe(3000);
    // onChange did NOT fire
    expect(changes).toEqual([]);
    // onError fired with 'merged'
    expect(errs.length).toBe(1);
    expect(errs[0]?.source).toBe("merged");
    expect(errs[0]?.err).toBeInstanceOf(AggregatedConfigError);
    await config.close();
  });
});

describe("defineConfig: close + idempotency", () => {
  it("close() unsubscribes; subsequent reload is a no-op returning current", async () => {
    const schema = z.object({ port: z.number() });
    let value = 3000;
    const config = await defineConfig({
      schema,
      sources: [
        {
          name: "test",
          priority: 100,
          read: () => Promise.resolve({ port: value }),
        },
      ],
    });
    const changes: number[] = [];
    config.onChange((next) => {
      changes.push((next as { port: number }).port);
    });
    await config.close();
    value = 8080;
    const result = await config.reload();
    // No reload happened; result is the snapshot at close time.
    expect(result.port).toBe(3000);
    expect(config.current.port).toBe(3000);
    expect(changes).toEqual([]);
  });

  it("close() is idempotent", async () => {
    const schema = z.object({ port: z.number() });
    const config = await defineConfig({
      schema,
      sources: [overrideSource({ port: 3000 })],
    });
    await config.close();
    await expect(config.close()).resolves.toBeUndefined();
  });
});

describe("defineConfig: file watcher integration", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "confetti-pipeline-watch-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("file change triggers onChange with diff (real fs, debounced)", async () => {
    const p = join(dir, "config.json");
    await writeFile(p, JSON.stringify({ port: 3000 }), "utf8");
    const schema = z.object({ port: z.number() });
    const config = await defineConfig({
      schema,
      sources: [fileSource({ path: p, watch: { debounceMs: 30 } })],
    });
    expect(config.current.port).toBe(3000);

    // Capture every onChange emission; filter for the one that reflects
    // the new value. Real fs watchers can emit spurious events from earlier
    // writes (parent-dir creation, atomic rename of the original write)
    // that race with our test setup — those will arrive carrying the OLD
    // port value, which we ignore.
    const seen: Array<{ port: number }> = [];
    let resolveChanged!: (next: { port: number }) => void;
    const changed = new Promise<{ port: number }>((resolve) => {
      resolveChanged = resolve;
    });
    config.onChange((next) => {
      const snap = next as { port: number };
      seen.push(snap);
      if (snap.port === 8080) resolveChanged(snap);
    });

    // Give the async watcher subscription time to attach.
    await new Promise((r) => setTimeout(r, 200));
    await writeFile(p, JSON.stringify({ port: 8080 }), "utf8");
    const next = await Promise.race([
      changed,
      new Promise<{ port: number }>((_, rej) =>
        setTimeout(() => rej(new Error("timeout waiting for change")), 5000),
      ),
    ]);
    expect(next.port).toBe(8080);
    expect(config.current.port).toBe(8080);
    await config.close();
  });
});

describe("defineConfig: concurrent reload coalescing", () => {
  it("concurrent reload() calls coalesce to a single in-flight + at most one pending", async () => {
    const schema = z.object({ port: z.number() });
    let runs = 0;
    // After the initial load, every subsequent read() parks until the test
    // pops a resolver off `pending`. The initial load resolves immediately
    // so defineConfig() itself doesn't hang.
    let initialDone = false;
    const pending: Array<(v: { port: number }) => void> = [];
    let value = 3000;
    const config = await defineConfig({
      schema,
      sources: [
        {
          name: "slow",
          priority: 100,
          read: () =>
            new Promise<{ port: number }>((resolve) => {
              runs++;
              const captured = value;
              if (!initialDone) {
                initialDone = true;
                resolve({ port: captured });
                return;
              }
              pending.push(() => resolve({ port: captured }));
            }),
        },
      ],
    });
    expect(runs).toBe(1);
    expect(pending.length).toBe(0);

    // Fire 3 reloads back-to-back.
    value = 4000;
    const r1 = config.reload();
    const r2 = config.reload();
    const r3 = config.reload();

    // Drain microtasks so triggerReload starts the first read().
    await new Promise((r) => setTimeout(r, 0));

    // Exactly one read should be in flight.
    expect(runs).toBe(2);
    expect(pending.length).toBe(1);

    // Resolve the first reload's read.
    value = 5000;
    pending.shift()!({ port: 4000 });

    // Allow notifyChange to run + the coalescer to spawn the pending reload.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // A second (coalesced) reload should now be in flight.
    expect(runs).toBe(3);
    expect(pending.length).toBe(1);

    // Resolve the second reload's read.
    pending.shift()!({ port: 5000 });

    const [n1, n2, n3] = await Promise.all([r1, r2, r3]);
    // All three callers receive the SAME final snapshot (latest-wins).
    expect(n1.port).toBe(5000);
    expect(n2.port).toBe(5000);
    expect(n3.port).toBe(5000);
    // No 4th run.
    expect(runs).toBe(3);
    await config.close();
  });
});

describe("defineConfig: source.watch async startup failures route to onError", () => {
  it("surfaces watchFile startup rejection through Config.onError(err, source.name)", async () => {
    // A custom Source whose watch() schedules an async failure. Mirrors
    // what fileSource does when watchFile rejects (e.g. runtime has no
    // watchPath, or the resolved symlink target is missing).
    const failingSource: import("./types.js").Source = {
      name: "broken-source",
      priority: 50,
      read: () => Promise.resolve({ port: 3000 }),
      watch(_notify, onError) {
        queueMicrotask(() => {
          onError?.(new Error("watch startup boom"));
        });
        return () => {};
      },
    };

    const errors: Array<{ err: unknown; source: string }> = [];
    const config = await defineConfig({
      schema: z.object({ port: z.number() }),
      sources: [failingSource],
    });
    config.onError((err, source) => {
      errors.push({ err, source });
    });

    // Wait one microtask cycle for the queued failure to land.
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toHaveLength(1);
    const captured = errors[0];
    if (!captured) throw new Error("no captured error");
    expect(captured.source).toBe("broken-source");
    expect(captured.err).toBeInstanceOf(Error);
    expect((captured.err as Error).message).toBe("watch startup boom");

    await config.close();
  });
});

describe("defineConfig: close() ordering", () => {
  it("does not invoke onChange handlers for reloads completing during close()", async () => {
    // Reload a few times normally, then call close() while a reload may
    // still be in flight. We assert no onChange fires AFTER close() begins.
    let resolveRead: (() => void) | null = null;
    const gated: import("./types.js").Source = {
      name: "gated",
      priority: 50,
      read: () =>
        new Promise<unknown>((resolve) => {
          // First call resolves immediately (initial load); subsequent
          // calls wait on resolveRead so we can interleave with close().
          if (!resolveRead) {
            resolve({ port: 3000 });
            resolveRead = () => {};
            return;
          }
          resolveRead = () => resolve({ port: 4000 });
        }),
    };
    const config = await defineConfig({
      schema: z.object({ port: z.number() }),
      sources: [gated],
    });
    const changes: number[] = [];
    config.onChange((next) => {
      changes.push((next as { port: number }).port);
    });

    // Start a reload but don't let it complete yet.
    const reloadPromise = config.reload();
    // Begin close (which awaits the inflight reload).
    const closePromise = config.close();
    // Now release the reload's read.
    resolveRead?.();
    await reloadPromise.catch(() => {});
    await closePromise;

    // Subscribers were cleared before the inflight resolved → no onChange.
    expect(changes).toEqual([]);
  });
});
