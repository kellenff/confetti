import { afterEach, describe, expect, it } from "vitest";
import { getRuntime, _resetRuntimeCache } from "./detect.js";
import { nodeRuntime } from "./node.js";
import type { Runtime } from "../types.js";

afterEach(() => _resetRuntimeCache());

describe("getRuntime", () => {
  it("returns the override when supplied", async () => {
    const fake: Runtime = {
      readFile: async () => "x",
      readEnv: () => undefined,
      listEnv: () => ({}),
    };
    const r = await getRuntime(fake);
    expect(r).toBe(fake);
  });

  it("detects Node and returns nodeRuntime", async () => {
    const r = await getRuntime();
    expect(r).toBe(nodeRuntime);
  });

  it("caches the resolved runtime", async () => {
    const a = await getRuntime();
    const b = await getRuntime();
    expect(a).toBe(b);
  });

  it("override bypasses cache without poisoning subsequent calls", async () => {
    const fake: Runtime = {
      readFile: async () => "x",
      readEnv: () => undefined,
      listEnv: () => ({}),
    };
    await getRuntime(fake);
    const r = await getRuntime();
    expect(r).toBe(nodeRuntime);
  });
});
