import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { isUnsupportedSchemaError } from "../env-keys/unsupported.js";
import { AggregatedConfigError, isAggregatedConfigError } from "../errors.js";
import type { Runtime } from "../types.js";
import { StandardPriority } from "../types.js";
import { envSource } from "./env.js";

/**
 * Build a fake Runtime backed by a fixed env map. listEnv filters by prefix.
 */
function fakeRuntime(env: Record<string, string>): Runtime {
  return {
    async readFile(): Promise<string> {
      throw new Error("readFile not used in env tests");
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

describe("envSource", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a single string field", async () => {
    const schema = z.object({ name: z.string() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_NAME: "alice" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ name: "alice" });
  });

  it("accepts empty string as a valid string value", async () => {
    const schema = z.object({ note: z.string() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_NOTE: "" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ note: "" });
  });

  it("trims surrounding whitespace before coercing booleans", async () => {
    const schema = z.object({ flag: z.boolean() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_FLAG: "  true  " }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ flag: true });
  });

  it("coerces numbers from strings", async () => {
    const schema = z.object({ port: z.number() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_PORT: "3000" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ port: 3000 });
  });

  it("aggregates a single coercion failure for invalid number", async () => {
    const schema = z.object({ port: z.number() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_PORT: "abc" }),
      warnOnUnknown: false,
    });

    let caught: unknown;
    try {
      await src.read();
    } catch (err) {
      caught = err;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    const e = caught as AggregatedConfigError;
    expect(e.issues).toHaveLength(1);
    const [issue] = e.issues;
    expect(issue?.source).toBe("env");
    expect(issue?.path).toEqual(["port"]);
    expect(issue?.message).toMatch(/number/);
    expect(issue?.code).toBe("env_coerce");
  });

  it("coerces all accepted boolean forms", async () => {
    const schema = z.object({ flag: z.boolean() });
    const trueForms = ["true", "True", "1", "yes", "YES", "on", "ON"];
    const falseForms = ["false", "FALSE", "0", "no", "off", ""];
    const trueResults = await Promise.all(
      trueForms.map((raw) =>
        envSource({
          schema,
          prefix: "APP_",
          runtime: fakeRuntime({ APP_FLAG: raw }),
          warnOnUnknown: false,
        }).read(),
      ),
    );
    for (const result of trueResults) {
      expect(result).toEqual({ flag: true });
    }
    const falseResults = await Promise.all(
      falseForms.map((raw) =>
        envSource({
          schema,
          prefix: "APP_",
          runtime: fakeRuntime({ APP_FLAG: raw }),
          warnOnUnknown: false,
        }).read(),
      ),
    );
    for (const result of falseResults) {
      expect(result).toEqual({ flag: false });
    }
  });

  it("rejects an unrecognized boolean form with a listing message", async () => {
    const schema = z.object({ flag: z.boolean() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_FLAG: "maybe" }),
      warnOnUnknown: false,
    });
    let caught: unknown;
    try {
      await src.read();
    } catch (err) {
      caught = err;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    const issue = (caught as AggregatedConfigError).issues[0];
    expect(issue?.message).toMatch(/true\/false\/1\/0\/yes\/no\/on\/off/);
    expect(issue?.message).toMatch(/maybe/);
  });

  it("coerces a string enum value", async () => {
    const schema = z.object({
      level: z.enum(["debug", "info", "warn", "error"]),
    });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_LEVEL: "warn" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ level: "warn" });
  });

  it("rejects an enum value not in the allowed set", async () => {
    const schema = z.object({
      level: z.enum(["debug", "info", "warn", "error"]),
    });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_LEVEL: "trace" }),
      warnOnUnknown: false,
    });
    let caught: unknown;
    try {
      await src.read();
    } catch (err) {
      caught = err;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    const issue = (caught as AggregatedConfigError).issues[0];
    expect(issue?.message).toMatch(/debug, info, warn, error/);
    expect(issue?.message).toMatch(/trace/);
  });

  it("coerces a numeric literal-union to a number", async () => {
    const schema = z.object({
      tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_TIER: "2" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ tier: 2 });
  });

  it("splits a comma list of strings into an array", async () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_TAGS: "a,b,c" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ tags: ["a", "b", "c"] });
  });

  it("coerces an array of numbers", async () => {
    const schema = z.object({ ports: z.array(z.number()) });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_PORTS: "3000,3001,3002" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ ports: [3000, 3001, 3002] });
  });

  it("reports per-item failures for arrays", async () => {
    const schema = z.object({ ports: z.array(z.number()) });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_PORTS: "3000,abc,3002" }),
      warnOnUnknown: false,
    });
    let caught: unknown;
    try {
      await src.read();
    } catch (err) {
      caught = err;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    const issue = (caught as AggregatedConfigError).issues[0];
    expect(issue?.path).toEqual(["ports"]);
    expect(issue?.message).toMatch(/abc/);
    expect(issue?.message).toMatch(/array of number/);
  });

  it("treats an empty string as an empty array", async () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_TAGS: "" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ tags: [] });
  });

  it("builds nested objects from prefixed env keys", async () => {
    const schema = z.object({
      server: z.object({
        port: z.number(),
        host: z.string(),
      }),
    });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({
        APP_SERVER__PORT: "3000",
        APP_SERVER__HOST: "localhost",
      }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({
      server: { port: 3000, host: "localhost" },
    });
  });

  it("returns undefined when an optional field is absent", async () => {
    const schema = z.object({ port: z.number().optional() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({}),
      warnOnUnknown: false,
    });
    expect(await src.read()).toBeUndefined();
  });

  it("returns the value when an optional field is present", async () => {
    const schema = z.object({ port: z.number().optional() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_PORT: "3000" }),
      warnOnUnknown: false,
    });
    expect(await src.read()).toEqual({ port: 3000 });
  });

  it("aggregates multiple coercion errors into one AggregatedConfigError", async () => {
    const schema = z.object({
      port: z.number(),
      flag: z.boolean(),
    });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({ APP_PORT: "abc", APP_FLAG: "maybe" }),
      warnOnUnknown: false,
    });
    let caught: unknown;
    try {
      await src.read();
    } catch (err) {
      caught = err;
    }
    expect(isAggregatedConfigError(caught)).toBe(true);
    const e = caught as AggregatedConfigError;
    expect(e.issues).toHaveLength(2);
    const paths = e.issues.map((i) => i.path.join("."));
    expect(paths).toContain("port");
    expect(paths).toContain("flag");
    expect(e.issues.every((i) => i.source === "env")).toBe(true);
  });

  it("uses default name='env' and priority=StandardPriority.env (50)", () => {
    const schema = z.object({ x: z.string() });
    const src = envSource({ schema, runtime: fakeRuntime({}) });
    expect(src.name).toBe("env");
    expect(src.priority).toBe(StandardPriority.env);
    expect(src.priority).toBe(50);
  });

  it("honours custom name and priority overrides", () => {
    const schema = z.object({ x: z.string() });
    const src = envSource({
      schema,
      name: "my-env",
      priority: 99,
      runtime: fakeRuntime({}),
    });
    expect(src.name).toBe("my-env");
    expect(src.priority).toBe(99);
  });

  it("warns about unknown prefixed env vars when warnOnUnknown=true", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = z.object({ port: z.number() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({
        APP_PORT: "3000",
        APP_TYPO: "huh",
        APP_OTHER: "x",
      }),
      warnOnUnknown: true,
    });
    await src.read();
    expect(warn).toHaveBeenCalledTimes(1);
    const call = warn.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/APP_TYPO/);
    expect(call).toMatch(/APP_OTHER/);
    expect(call).not.toMatch(/APP_PORT[^_]/); // PORT itself isn't unknown
  });

  it("does not warn when warnOnUnknown=false", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = z.object({ port: z.number() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime: fakeRuntime({
        APP_PORT: "3000",
        APP_TYPO: "huh",
      }),
      warnOnUnknown: false,
    });
    await src.read();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when prefix is empty even if warnOnUnknown=true", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = z.object({ port: z.number() });
    const src = envSource({
      schema,
      prefix: "",
      runtime: fakeRuntime({ PORT: "3000", OTHER: "x" }),
      warnOnUnknown: true,
    });
    await src.read();
    expect(warn).not.toHaveBeenCalled();
  });

  it("propagates UnsupportedSchemaError at construction time, not in read()", () => {
    const schema = z.object({
      x: z.string().transform((s) => s.toUpperCase()),
    });
    let caught: unknown;
    try {
      envSource({ schema, prefix: "APP_", runtime: fakeRuntime({}) });
    } catch (err) {
      caught = err;
    }
    expect(isUnsupportedSchemaError(caught)).toBe(true);
  });

  it("uses the provided custom runtime for readEnv and listEnv", async () => {
    const reads: string[] = [];
    const lists: string[] = [];
    const runtime: Runtime = {
      async readFile(): Promise<string> {
        throw new Error("not used");
      },
      readEnv: (key: string) => {
        reads.push(key);
        if (key === "APP_NAME") return "alice";
        return undefined;
      },
      listEnv: (prefix: string) => {
        lists.push(prefix);
        return { APP_NAME: "alice", APP_TYPO: "x" };
      },
    };
    const schema = z.object({ name: z.string() });
    const src = envSource({
      schema,
      prefix: "APP_",
      runtime,
      warnOnUnknown: true,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await src.read()).toEqual({ name: "alice" });
    expect(reads).toContain("APP_NAME");
    expect(lists).toContain("APP_");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
