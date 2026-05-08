import { describe, expect, it, afterEach } from "vitest";
import {
  deepMerge as deepMergeRaw,
  type MergeLayer,
  type MergeResult,
} from "./merge.js";
import type { SourceName } from "./types.js";

/**
 * Test-local wrapper: most existing tests pass layers without a `source`
 * because they predate provenance tracking. Default to a stable name so
 * we don't have to touch ~30 call sites that don't care about provenance.
 */
type LooseLayer = Omit<MergeLayer, "source"> & { source?: SourceName };
function deepMerge(layers: readonly LooseLayer[]): unknown {
  const filled: MergeLayer[] = layers.map((l, i) => ({
    ...l,
    source: l.source ?? `test-${i}`,
  }));
  return deepMergeRaw(filled).value;
}
function deepMergeFull(layers: readonly LooseLayer[]): MergeResult {
  const filled: MergeLayer[] = layers.map((l, i) => ({
    ...l,
    source: l.source ?? `test-${i}`,
  }));
  return deepMergeRaw(filled);
}

// Helper: snapshot Object.prototype keys to ensure no pollution leaked.
function prototypeKeysSnapshot(): string[] {
  return Object.getOwnPropertyNames(Object.prototype).sort();
}

const PROTO_KEYS_BEFORE = prototypeKeysSnapshot();

afterEach(() => {
  // Defensive: scrub anything that may have leaked despite the guard.
  const after = prototypeKeysSnapshot();
  for (const k of after) {
    if (!PROTO_KEYS_BEFORE.includes(k)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (Object.prototype as any)[k];
    }
  }
});

describe("deepMerge — empty + single-layer cases", () => {
  it("returns undefined for empty input", () => {
    expect(deepMerge([])).toBeUndefined();
  });

  it("returns the single layer's value for a single layer", () => {
    expect(deepMerge([{ value: 42 }])).toBe(42);
  });

  it("returns undefined when the only layer's value is undefined", () => {
    expect(deepMerge([{ value: undefined }])).toBeUndefined();
  });

  it("returns the only layer's object as-is structurally", () => {
    const obj = { a: 1, b: { c: 2 } };
    const result = deepMerge([{ value: obj }]);
    expect(result).toEqual(obj);
  });
});

describe("deepMerge — primitive override", () => {
  it("higher layer overrides lower for numbers", () => {
    expect(deepMerge([{ value: 1 }, { value: 2 }])).toBe(2);
  });

  it("rightmost wins across many primitive layers", () => {
    expect(deepMerge([{ value: "a" }, { value: "b" }, { value: "c" }])).toBe(
      "c",
    );
  });

  it("higher boolean overrides lower number", () => {
    expect(deepMerge([{ value: 0 }, { value: true }])).toBe(true);
  });

  it("higher string overrides lower string", () => {
    expect(deepMerge([{ value: "low" }, { value: "high" }])).toBe("high");
  });
});

describe("deepMerge — undefined-as-no-contribution", () => {
  it("undefined high preserves low primitive", () => {
    expect(deepMerge([{ value: "low" }, { value: undefined }])).toBe("low");
  });

  it("undefined low yields high", () => {
    expect(deepMerge([{ value: undefined }, { value: "high" }])).toBe("high");
  });

  it("undefined high preserves low object", () => {
    const low = { a: 1 };
    expect(deepMerge([{ value: low }, { value: undefined }])).toEqual({
      a: 1,
    });
  });

  it("undefined nested key from high preserves low's value at that key", () => {
    const result = deepMerge([
      { value: { a: 1, b: 2 } },
      { value: { b: undefined } },
    ]);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("multiple undefined layers are ignored", () => {
    expect(
      deepMerge([{ value: "x" }, { value: undefined }, { value: undefined }]),
    ).toBe("x");
  });
});

describe("deepMerge — null is a deliberate value", () => {
  it("higher null overrides lower string", () => {
    expect(deepMerge([{ value: "x" }, { value: null }])).toBeNull();
  });

  it("undefined cannot overwrite a deliberate null below", () => {
    expect(deepMerge([{ value: null }, { value: undefined }])).toBeNull();
  });

  it("nested null overrides nested object", () => {
    const result = deepMerge([
      { value: { a: { x: 1 } } },
      { value: { a: null } },
    ]);
    expect(result).toEqual({ a: null });
  });

  it("nested undefined preserves nested object", () => {
    const result = deepMerge([
      { value: { a: { x: 1 } } },
      { value: { a: undefined } },
    ]);
    expect(result).toEqual({ a: { x: 1 } });
  });
});

describe("deepMerge — object deep merge", () => {
  it("merges disjoint keys", () => {
    expect(deepMerge([{ value: { a: 1 } }, { value: { b: 2 } }])).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("higher value wins on overlapping keys", () => {
    expect(deepMerge([{ value: { a: 1 } }, { value: { a: 2 } }])).toEqual({
      a: 2,
    });
  });

  it("recurses into nested objects merging both sides", () => {
    expect(
      deepMerge([{ value: { a: { x: 1 } } }, { value: { a: { y: 2 } } }]),
    ).toEqual({ a: { x: 1, y: 2 } });
  });

  it("recurses several levels deep", () => {
    expect(
      deepMerge([
        { value: { a: { b: { c: 1 } } } },
        { value: { a: { b: { d: 2 } } } },
      ]),
    ).toEqual({ a: { b: { c: 1, d: 2 } } });
  });

  it("merges keys across more than two layers", () => {
    expect(
      deepMerge([
        { value: { a: 1 } },
        { value: { b: 2 } },
        { value: { c: 3 } },
      ]),
    ).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe("deepMerge — type mismatch (high wins wholesale)", () => {
  it("object replaced by string", () => {
    expect(
      deepMerge([{ value: { a: { x: 1 } } }, { value: { a: "string" } }]),
    ).toEqual({ a: "string" });
  });

  it("string replaced by object", () => {
    expect(
      deepMerge([{ value: { a: "string" } }, { value: { a: { x: 1 } } }]),
    ).toEqual({ a: { x: 1 } });
  });

  it("array replaced by object", () => {
    expect(
      deepMerge([{ value: { a: [1, 2] } }, { value: { a: { x: 1 } } }]),
    ).toEqual({ a: { x: 1 } });
  });

  it("object replaced by array", () => {
    expect(
      deepMerge([{ value: { a: { x: 1 } } }, { value: { a: [1, 2] } }]),
    ).toEqual({ a: [1, 2] });
  });

  it("number replaced by array", () => {
    expect(deepMerge([{ value: 42 }, { value: [1, 2] }])).toEqual([1, 2]);
  });
});

describe("deepMerge — array policy", () => {
  it("default policy is replace", () => {
    expect(
      deepMerge([{ value: { tags: [1, 2] } }, { value: { tags: [3, 4] } }]),
    ).toEqual({ tags: [3, 4] });
  });

  it("explicit replace overrides", () => {
    expect(
      deepMerge([
        { value: { tags: [1, 2] } },
        { value: { tags: [3, 4] }, arrayMerge: "replace" },
      ]),
    ).toEqual({ tags: [3, 4] });
  });

  it("concat appends high to low (low first, high after)", () => {
    expect(
      deepMerge([
        { value: { tags: [1, 2] } },
        { value: { tags: [3, 4] }, arrayMerge: "concat" },
      ]),
    ).toEqual({ tags: [1, 2, 3, 4] });
  });

  it("concat preserves order across three layers when each layer is concat", () => {
    expect(
      deepMerge([
        { value: { tags: [1] } },
        { value: { tags: [2] }, arrayMerge: "concat" },
        { value: { tags: [3] }, arrayMerge: "concat" },
      ]),
    ).toEqual({ tags: [1, 2, 3] });
  });

  it("per-layer policy: layer 2 replace, layer 3 concat → only [3,4]+[5,6]", () => {
    // layer1: [1,2]
    // layer2 replace → [3,4]
    // layer3 concat against [3,4] → [3,4,5,6]
    expect(
      deepMerge([
        { value: { tags: [1, 2] } },
        { value: { tags: [3, 4] }, arrayMerge: "replace" },
        { value: { tags: [5, 6] }, arrayMerge: "concat" },
      ]),
    ).toEqual({ tags: [3, 4, 5, 6] });
  });

  it("per-layer policy: layer 2 concat, layer 3 replace → only layer 3", () => {
    expect(
      deepMerge([
        { value: { tags: [1, 2] } },
        { value: { tags: [3, 4] }, arrayMerge: "concat" },
        { value: { tags: [5, 6] }, arrayMerge: "replace" },
      ]),
    ).toEqual({ tags: [5, 6] });
  });

  it("concat policy applies recursively into nested arrays", () => {
    expect(
      deepMerge([
        { value: { a: { tags: [1] } } },
        { value: { a: { tags: [2] } }, arrayMerge: "concat" },
      ]),
    ).toEqual({ a: { tags: [1, 2] } });
  });

  it("array merge does not affect plain objects in same layer", () => {
    expect(
      deepMerge([
        { value: { tags: [1], cfg: { a: 1 } } },
        { value: { tags: [2], cfg: { b: 2 } }, arrayMerge: "concat" },
      ]),
    ).toEqual({ tags: [1, 2], cfg: { a: 1, b: 2 } });
  });
});

describe("deepMerge — prototype pollution defense", () => {
  it("ignores top-level __proto__ key from higher layer", () => {
    const polluted = JSON.parse('{"__proto__": {"polluted": true}}') as Record<
      string,
      unknown
    >;
    const result = deepMerge([{ value: { a: 1 } }, { value: polluted }]) as
      | Record<string, unknown>
      | undefined;
    expect(result).toEqual({ a: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result as any)?.polluted).toBeUndefined();
  });

  it("ignores nested __proto__ key during recursion", () => {
    const polluted = JSON.parse('{"a": {"__proto__": {"x": 1}}}') as Record<
      string,
      unknown
    >;
    const result = deepMerge([{ value: { a: {} } }, { value: polluted }]) as {
      a: Record<string, unknown>;
    };
    expect(result.a).toEqual({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result.a as any).x).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).x).toBeUndefined();
  });

  it("drops constructor key during recursion", () => {
    const result = deepMerge([
      { value: { a: {} } },
      { value: { a: { constructor: "evil" } } },
    ]) as { a: Record<string, unknown> };
    // constructor is a pollution key; it must not appear as own property
    expect(Object.prototype.hasOwnProperty.call(result.a, "constructor")).toBe(
      false,
    );
  });

  it("drops prototype key during recursion", () => {
    const result = deepMerge([
      { value: { a: {} } },
      { value: { a: { prototype: { evil: true } } } },
    ]) as { a: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(result.a, "prototype")).toBe(
      false,
    );
  });

  it("does not pollute Object.prototype after multiple attacks", () => {
    const before = prototypeKeysSnapshot();
    const a1 = JSON.parse('{"__proto__":{"p1":1}}') as Record<string, unknown>;
    const a2 = JSON.parse('{"x":{"__proto__":{"p2":2}}}') as Record<
      string,
      unknown
    >;
    deepMerge([{ value: {} }, { value: a1 }, { value: a2 }]);
    expect(prototypeKeysSnapshot()).toEqual(before);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).p1).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).p2).toBeUndefined();
  });
});

describe("deepMerge — plain object discrimination", () => {
  it("class instances are not deep-merged (high wins wholesale)", () => {
    class Foo {
      readonly tag = "foo";
    }
    const inst = new Foo();
    const result = deepMerge([
      { value: { a: inst } },
      { value: { a: { x: 1 } } },
    ]);
    expect(result).toEqual({ a: { x: 1 } });
  });

  it("class instance on the high side replaces low plain object wholesale", () => {
    class Foo {
      readonly tag = "foo";
    }
    const inst = new Foo();
    const result = deepMerge([
      { value: { a: { x: 1 } } },
      { value: { a: inst } },
    ]) as { a: Foo };
    expect(result.a).toBe(inst);
  });

  it("Date instance treated as opaque (high wins wholesale)", () => {
    const d = new Date(0);
    const result = deepMerge([
      { value: { ts: { old: true } } },
      { value: { ts: d } },
    ]) as { ts: Date };
    expect(result.ts).toBe(d);
  });

  it("Map instance treated as opaque", () => {
    const m = new Map([["k", "v"]]);
    const result = deepMerge([
      { value: { m: { foo: 1 } } },
      { value: { m } },
    ]) as { m: Map<string, string> };
    expect(result.m).toBe(m);
  });

  it("RegExp instance treated as opaque", () => {
    const r = /abc/;
    const result = deepMerge([
      { value: { r: { source: "old" } } },
      { value: { r } },
    ]) as { r: RegExp };
    expect(result.r).toBe(r);
  });

  it("Object.create(null) is treated as plain and merged", () => {
    const low = Object.create(null) as Record<string, unknown>;
    low["a"] = 1;
    const high = Object.create(null) as Record<string, unknown>;
    high["b"] = 2;
    const result = deepMerge([{ value: low }, { value: high }]);
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe("deepMerge — many-layer realistic scenario", () => {
  it("merges default → file → env → flag → override", () => {
    const defaults: LooseLayer = {
      value: {
        server: { host: "0.0.0.0", port: 8080 },
        log: { level: "info", format: "text" },
        features: { beta: false },
        tags: ["default"],
      },
    };
    const file: LooseLayer = {
      value: {
        server: { port: 9090 },
        log: { format: "json" },
        tags: ["file-a", "file-b"],
      },
    };
    const env: LooseLayer = {
      value: {
        server: { host: "127.0.0.1" },
        log: { level: undefined },
      },
    };
    const flag: LooseLayer = {
      value: {
        features: { beta: true },
      },
    };
    const override: LooseLayer = {
      value: {
        log: { level: "debug" },
      },
    };

    const merged = deepMerge([defaults, file, env, flag, override]);
    expect(merged).toEqual({
      server: { host: "127.0.0.1", port: 9090 },
      log: { level: "debug", format: "json" },
      features: { beta: true },
      tags: ["file-a", "file-b"],
    });
  });

  it("realistic scenario with concat policy on a layer", () => {
    const defaults: LooseLayer = {
      value: { plugins: ["core"] },
    };
    const file: LooseLayer = {
      value: { plugins: ["auth", "logger"] },
      arrayMerge: "concat",
    };
    const flag: LooseLayer = {
      value: { plugins: ["debug"] },
      arrayMerge: "concat",
    };
    expect(deepMerge([defaults, file, flag])).toEqual({
      plugins: ["core", "auth", "logger", "debug"],
    });
  });
});

describe("deepMerge — purity (no input mutation)", () => {
  it("does not mutate input objects", () => {
    const low = { a: 1, nested: { x: 1 } };
    const high = { b: 2, nested: { y: 2 } };
    const lowCopy = JSON.parse(JSON.stringify(low));
    const highCopy = JSON.parse(JSON.stringify(high));
    const result = deepMerge([{ value: low }, { value: high }]);
    expect(low).toEqual(lowCopy);
    expect(high).toEqual(highCopy);
    expect(result).toEqual({ a: 1, b: 2, nested: { x: 1, y: 2 } });
  });

  it("does not mutate input arrays under concat policy", () => {
    const low = { tags: [1, 2] };
    const high = { tags: [3, 4] };
    const lowCopy = [...low.tags];
    const highCopy = [...high.tags];
    const result = deepMerge([
      { value: low },
      { value: high, arrayMerge: "concat" },
    ]) as { tags: number[] };
    expect(low.tags).toEqual(lowCopy);
    expect(high.tags).toEqual(highCopy);
    expect(result.tags).toEqual([1, 2, 3, 4]);
    // Verify result.tags is not the same array reference as either input.
    expect(result.tags).not.toBe(low.tags);
    expect(result.tags).not.toBe(high.tags);
  });

  it("does not mutate input arrays under replace policy", () => {
    const low = { tags: [1, 2] };
    const high = { tags: [3, 4] };
    const result = deepMerge([{ value: low }, { value: high }]) as {
      tags: number[];
    };
    // result should be a fresh array, mutating it must not affect inputs.
    result.tags.push(99);
    expect(low.tags).toEqual([1, 2]);
    expect(high.tags).toEqual([3, 4]);
  });

  it("nested merge does not alias low's nested object", () => {
    const low = { nested: { x: 1 } };
    const high = { nested: { y: 2 } };
    const result = deepMerge([{ value: low }, { value: high }]) as {
      nested: Record<string, unknown>;
    };
    result.nested["z"] = 3;
    expect(low.nested).toEqual({ x: 1 });
    expect(high.nested).toEqual({ y: 2 });
  });
});

describe("deepMerge — provenance", () => {
  it("returns an empty map for empty input", () => {
    const { provenance } = deepMergeFull([]);
    expect(provenance.size).toBe(0);
  });

  it("records provenance for a single primitive at root", () => {
    const { provenance } = deepMergeFull([{ value: 42, source: "default" }]);
    expect(provenance.get("")).toBe("default");
  });

  it("records provenance for nested primitives", () => {
    const { provenance } = deepMergeFull([
      { value: { server: { port: 8080, host: "localhost" } }, source: "file" },
    ]);
    expect(provenance.get("server.port")).toBe("file");
    expect(provenance.get("server.host")).toBe("file");
    // Object paths themselves are not recorded.
    expect(provenance.has("server")).toBe(false);
    expect(provenance.has("")).toBe(false);
  });

  it("higher layer wins → provenance reflects the higher layer's source", () => {
    const { provenance } = deepMergeFull([
      { value: { port: 3000 }, source: "default" },
      { value: { port: 5000 }, source: "override" },
    ]);
    expect(provenance.get("port")).toBe("override");
  });

  it("undefined from higher does NOT overwrite lower's provenance", () => {
    const { provenance } = deepMergeFull([
      { value: { port: 3000 }, source: "default" },
      { value: { port: undefined }, source: "env" },
    ]);
    expect(provenance.get("port")).toBe("default");
  });

  it("array with replace policy → provenance = higher layer", () => {
    const { provenance } = deepMergeFull([
      { value: { tags: ["a", "b"] }, source: "default" },
      { value: { tags: ["c"] }, source: "override", arrayMerge: "replace" },
    ]);
    expect(provenance.get("tags")).toBe("override");
  });

  it("array with concat policy → provenance = higher layer (per A1)", () => {
    const { provenance } = deepMergeFull([
      { value: { tags: ["a"] }, source: "default" },
      { value: { tags: ["b"] }, source: "file", arrayMerge: "concat" },
    ]);
    expect(provenance.get("tags")).toBe("file");
  });

  it("mixes provenance across keys depending on which layer last wrote each leaf", () => {
    const { provenance } = deepMergeFull([
      {
        value: { server: { host: "0.0.0.0", port: 8080 } },
        source: "default",
      },
      { value: { server: { port: 9090 } }, source: "file" },
      { value: { server: { host: "127.0.0.1" } }, source: "env" },
    ]);
    expect(provenance.get("server.host")).toBe("env");
    expect(provenance.get("server.port")).toBe("file");
  });

  it("single layer covers every leaf with that source", () => {
    const { provenance } = deepMergeFull([
      {
        value: {
          a: 1,
          b: { c: 2, d: { e: 3 } },
          tags: [1, 2, 3],
          nul: null,
        },
        source: "override",
      },
    ]);
    expect(provenance.get("a")).toBe("override");
    expect(provenance.get("b.c")).toBe("override");
    expect(provenance.get("b.d.e")).toBe("override");
    expect(provenance.get("tags")).toBe("override");
    expect(provenance.get("nul")).toBe("override");
  });

  it("prunes stale subtree entries when an object is replaced by a primitive", () => {
    const { provenance } = deepMergeFull([
      { value: { x: { y: 1, z: { w: 2 } } }, source: "default" },
      { value: { x: "hello" }, source: "override" },
    ]);
    expect(provenance.get("x")).toBe("override");
    expect(provenance.has("x.y")).toBe(false);
    expect(provenance.has("x.z.w")).toBe(false);
  });

  it("prunes stale subtree when an object is replaced by an array", () => {
    const { provenance } = deepMergeFull([
      { value: { x: { y: 1, z: 2 } }, source: "default" },
      { value: { x: [1, 2, 3] }, source: "override" },
    ]);
    expect(provenance.get("x")).toBe("override");
    expect(provenance.has("x.y")).toBe(false);
    expect(provenance.has("x.z")).toBe(false);
  });

  it("prunes stale leaf entry when a primitive is replaced by an object", () => {
    const { provenance } = deepMergeFull([
      { value: { x: "hello" }, source: "default" },
      { value: { x: { y: 1 } }, source: "override" },
    ]);
    expect(provenance.has("x")).toBe(false);
    expect(provenance.get("x.y")).toBe("override");
  });

  it("prunes stale array leaf when an array is replaced by an object", () => {
    const { provenance } = deepMergeFull([
      { value: { x: [1, 2] }, source: "default" },
      { value: { x: { y: 1 } }, source: "override" },
    ]);
    expect(provenance.has("x")).toBe(false);
    expect(provenance.get("x.y")).toBe("override");
  });
});
