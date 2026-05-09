/**
 * Public type-surface assertions (SC1).
 *
 * These tests assert the SHAPE of the public API at compile time using
 * `expect-type`. The runtime body of each `it(...)` is trivial — the
 * assertion lives in the type-checker. If `tsc -p tsconfig.test.json`
 * passes, the type contracts hold.
 *
 * The transform-schema case is a special exception: defineConfig refuses
 * z.transform at runtime via UnsupportedSchemaError, so we use static
 * type assertions only (no defineConfig call).
 */

import { expectTypeOf } from "expect-type";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineConfig,
  overrideSource,
  StandardPriority,
  type Config,
  type ConfigDiff,
  type ErrorHandler,
  type ReloadHandler,
  type Source,
  type SourceName,
  type Unwatch,
} from "../src/index.js";

describe("Config<T>.current type === z.output<typeof schema> (SC1)", () => {
  it("primitives only", async () => {
    const schema = z.object({ port: z.number(), host: z.string() });
    const config = await defineConfig({
      schema,
      sources: [overrideSource({ port: 5000, host: "localhost" })],
    });
    expectTypeOf(config.current).toEqualTypeOf<z.output<typeof schema>>();
    expectTypeOf(config.current).toEqualTypeOf<{
      port: number;
      host: string;
    }>();
    expect(true).toBe(true);
  });

  it("nested objects", async () => {
    const schema = z.object({
      server: z.object({ port: z.number(), host: z.string() }),
      logging: z.object({ level: z.string() }),
    });
    const config = await defineConfig({
      schema,
      sources: [
        overrideSource({
          server: { port: 8080, host: "0.0.0.0" },
          logging: { level: "info" },
        }),
      ],
    });
    expectTypeOf(config.current).toEqualTypeOf<z.output<typeof schema>>();
    expectTypeOf(config.current).toEqualTypeOf<{
      server: { port: number; host: string };
      logging: { level: string };
    }>();
    expect(true).toBe(true);
  });

  it("optional fields preserve optionality on output", async () => {
    const schema = z.object({
      foo: z.string().optional(),
      bar: z.number(),
    });
    const config = await defineConfig({
      schema,
      sources: [overrideSource({ bar: 1 })],
    });
    expectTypeOf(config.current).toEqualTypeOf<z.output<typeof schema>>();
    expectTypeOf(config.current).toEqualTypeOf<{
      foo?: string | undefined;
      bar: number;
    }>();
    expect(true).toBe(true);
  });

  it("defaults: z.input vs z.output diverge", async () => {
    const schema = z.object({ port: z.number().default(3000) });
    const config = await defineConfig({
      schema,
      // Empty override; the default fills in.
      sources: [overrideSource({})],
    });
    // Output side: port is required (default applied).
    expectTypeOf(config.current).toEqualTypeOf<z.output<typeof schema>>();
    expectTypeOf(config.current).toEqualTypeOf<{ port: number }>();
    // Input side: port is optional. Confirm divergence.
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<{
      port?: number | undefined;
    }>();
    expect(true).toBe(true);
  });

  it("transforms: Config.current reflects z.output (post-transform), not z.input", () => {
    // NOTE: z.transform / ZodEffects is rejected at runtime via
    // UnsupportedSchemaError, so we cannot call defineConfig here.
    // The compile-time assertion is still meaningful: it documents that
    // when a hypothetical transform-aware build supports this case, the
    // generic plumbing carries z.output forward correctly.
    const schema = z.object({
      port: z
        .string()
        .transform((s) => Number.parseInt(s, 10))
        .pipe(z.number()),
    });
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<{ port: string }>();
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<{ port: number }>();
    type ResultType = Awaited<ReturnType<typeof defineConfig<typeof schema>>>;
    expectTypeOf<ResultType["current"]>().toEqualTypeOf<{ port: number }>();
    expect(true).toBe(true);
  });
});

describe("auxiliary public types (SC1)", () => {
  it("Source has the expected structural contract", () => {
    expectTypeOf<Source>().toMatchTypeOf<{
      readonly name: string;
      readonly priority: number;
      read(): Promise<unknown>;
    }>();
    expect(true).toBe(true);
  });

  it("ConfigDiff is ReadonlyArray<{ path; before; after }>", () => {
    expectTypeOf<ConfigDiff>().toEqualTypeOf<
      ReadonlyArray<{
        readonly path: readonly string[];
        readonly before: unknown;
        readonly after: unknown;
      }>
    >();
    expect(true).toBe(true);
  });

  it("ReloadHandler is (next, diff) => void | Promise<void>", () => {
    expectTypeOf<ReloadHandler>().toEqualTypeOf<
      (next: unknown, diff: ConfigDiff) => void | Promise<void>
    >();
    expect(true).toBe(true);
  });

  it("ErrorHandler is (err, source) => void", () => {
    expectTypeOf<ErrorHandler>().toEqualTypeOf<
      (err: unknown, source: SourceName) => void
    >();
    expect(true).toBe(true);
  });

  it("Unwatch is () => void | Promise<void>", () => {
    expectTypeOf<Unwatch>().toEqualTypeOf<() => void | Promise<void>>();
    expect(true).toBe(true);
  });
});

describe("StandardPriority literal numeric values (SC1)", () => {
  it("default = 0", () => {
    expectTypeOf(StandardPriority.default).toEqualTypeOf<0>();
    expect(StandardPriority.default).toBe(0);
  });

  it("file = 25", () => {
    expectTypeOf(StandardPriority.file).toEqualTypeOf<25>();
    expect(StandardPriority.file).toBe(25);
  });

  it("env = 50", () => {
    expectTypeOf(StandardPriority.env).toEqualTypeOf<50>();
    expect(StandardPriority.env).toBe(50);
  });

  it("flag = 75", () => {
    expectTypeOf(StandardPriority.flag).toEqualTypeOf<75>();
    expect(StandardPriority.flag).toBe(75);
  });

  it("override = 100", () => {
    expectTypeOf(StandardPriority.override).toEqualTypeOf<100>();
    expect(StandardPriority.override).toBe(100);
  });
});

describe("Config<T> shape", () => {
  it("Config<{port: number}> exposes current/reload/onChange/onError/close", () => {
    type C = Config<{ port: number }>;
    expectTypeOf<C["current"]>().toEqualTypeOf<{ port: number }>();
    expectTypeOf<C["reload"]>().toEqualTypeOf<
      () => Promise<{ port: number }>
    >();
    expectTypeOf<C["onChange"]>().toEqualTypeOf<
      (handler: ReloadHandler) => Unwatch
    >();
    expectTypeOf<C["onError"]>().toEqualTypeOf<
      (handler: ErrorHandler) => Unwatch
    >();
    expectTypeOf<C["close"]>().toEqualTypeOf<() => Promise<void>>();
    expect(true).toBe(true);
  });
});
