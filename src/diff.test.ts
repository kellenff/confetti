import { describe, expect, it } from "vitest";
import { diff } from "./diff.js";

describe("diff: no-op", () => {
  it("returns [] for strictly identical primitives", () => {
    expect(diff(1, 1)).toEqual([]);
    expect(diff("x", "x")).toEqual([]);
    expect(diff(null, null)).toEqual([]);
    expect(diff(true, true)).toEqual([]);
  });

  it("returns [] for structurally equal objects", () => {
    expect(diff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
  });

  it("returns [] for structurally equal arrays", () => {
    expect(diff([1, 2, 3], [1, 2, 3])).toEqual([]);
  });
});

describe("diff: primitive changes", () => {
  it("emits one entry at the root for top-level primitive change", () => {
    expect(diff(1, 2)).toEqual([{ path: [], before: 1, after: 2 }]);
  });

  it("emits one entry at a nested path for nested primitive change", () => {
    expect(diff({ a: 1 }, { a: 2 })).toEqual([
      { path: ["a"], before: 1, after: 2 },
    ]);
  });

  it("treats null vs primitive as a primitive change at that path", () => {
    expect(diff({ a: null }, { a: 1 })).toEqual([
      { path: ["a"], before: null, after: 1 },
    ]);
  });
});

describe("diff: object additions / removals", () => {
  it("emits before:undefined for additions", () => {
    expect(diff({ a: 1 }, { a: 1, b: 2 })).toEqual([
      { path: ["b"], before: undefined, after: 2 },
    ]);
  });

  it("emits after:undefined for removals", () => {
    expect(diff({ a: 1, b: 2 }, { a: 1 })).toEqual([
      { path: ["b"], before: 2, after: undefined },
    ]);
  });

  it("handles addition + removal + change in one pass, lexicographically sorted", () => {
    const result = diff({ a: 1, b: 2 }, { a: 99, c: 3 });
    expect(result).toEqual([
      { path: ["a"], before: 1, after: 99 },
      { path: ["b"], before: 2, after: undefined },
      { path: ["c"], before: undefined, after: 3 },
    ]);
  });
});

describe("diff: arrays compared as wholes", () => {
  it("emits one entry when an array element changes", () => {
    expect(diff({ tags: [1, 2] }, { tags: [1, 3] })).toEqual([
      { path: ["tags"], before: [1, 2], after: [1, 3] },
    ]);
  });

  it("emits one entry when an array grows", () => {
    expect(diff({ tags: [1, 2] }, { tags: [1, 2, 3] })).toEqual([
      { path: ["tags"], before: [1, 2], after: [1, 2, 3] },
    ]);
  });

  it("emits one entry when an array shrinks", () => {
    expect(diff({ tags: [1, 2, 3] }, { tags: [1, 2] })).toEqual([
      { path: ["tags"], before: [1, 2, 3], after: [1, 2] },
    ]);
  });

  it("does not emit per-index entries (no diff explosion)", () => {
    const before = [1, 2, 3, 4, 5];
    const after = [9, 9, 9, 9, 9];
    const result = diff({ xs: before }, { xs: after });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toEqual(["xs"]);
  });
});

describe("diff: type mismatch at a path", () => {
  it("object → primitive at a path emits ONE entry, no recursion", () => {
    const result = diff({ a: { b: 1 } }, { a: 7 });
    expect(result).toEqual([{ path: ["a"], before: { b: 1 }, after: 7 }]);
  });

  it("primitive → object at a path emits ONE entry, no recursion", () => {
    const result = diff({ a: 7 }, { a: { b: 1 } });
    expect(result).toEqual([{ path: ["a"], before: 7, after: { b: 1 } }]);
  });

  it("array → object at a path emits ONE entry", () => {
    expect(diff({ a: [1, 2] }, { a: { x: 1 } })).toEqual([
      { path: ["a"], before: [1, 2], after: { x: 1 } },
    ]);
  });

  it("object → array at a path emits ONE entry", () => {
    expect(diff({ a: { x: 1 } }, { a: [1, 2] })).toEqual([
      { path: ["a"], before: { x: 1 }, after: [1, 2] },
    ]);
  });

  it("array → primitive at a path emits ONE entry", () => {
    expect(diff({ a: [1, 2] }, { a: 7 })).toEqual([
      { path: ["a"], before: [1, 2], after: 7 },
    ]);
  });
});

describe("diff: nested objects", () => {
  it("recurses into nested objects", () => {
    const result = diff(
      { server: { port: 3000, host: "localhost" } },
      { server: { port: 8080, host: "localhost" } },
    );
    expect(result).toEqual([
      { path: ["server", "port"], before: 3000, after: 8080 },
    ]);
  });

  it("emits multiple entries for multiple nested changes, sorted lex by joined path", () => {
    const result = diff(
      { a: { z: 1 }, b: { y: 2 } },
      { a: { z: 99 }, b: { y: 88 } },
    );
    expect(result).toEqual([
      { path: ["a", "z"], before: 1, after: 99 },
      { path: ["b", "y"], before: 2, after: 88 },
    ]);
  });
});

describe("diff: lexicographic ordering", () => {
  it("sorts entries by path.join('.') ascending", () => {
    const result = diff({ z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 });
    expect(result.map((e) => e.path.join("."))).toEqual(["a", "m", "z"]);
  });

  it("orders nested paths after their shorter prefixes lexicographically", () => {
    // 'a' < 'a.b' lexicographically since '' < '.' is FALSE (. is 0x2e, b is 0x62)
    // Actually '' < '.b' so 'a' < 'a.b' is true.
    const result = diff(
      { a: { b: 1 }, "a.flat": 0 },
      { a: { b: 2 }, "a.flat": 1 },
    );
    const keys = result.map((e) => e.path.join("."));
    // 'a.b' and 'a.flat' both sort lex; ensure deterministic.
    expect(keys).toEqual([...keys].sort());
  });
});
