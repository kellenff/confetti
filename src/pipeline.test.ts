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

  it("each issue carries source='merged' and a Zod code", async () => {
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
    expect(first?.source).toBe("merged");
    expect(first?.code).toBe("invalid_type");
    expect(first?.path).toEqual(["port"]);
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
  });
});
