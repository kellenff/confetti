import { describe, expect, it } from "vitest";
import { overrideSource } from "./override.js";
import { defaultsSource } from "./defaults.js";
import { flagsSource } from "./flags.js";
import { StandardPriority } from "../types.js";

describe("overrideSource", () => {
  it("uses name='override' and priority=100 by default", () => {
    const s = overrideSource({ a: 1 });
    expect(s.name).toBe("override");
    expect(s.priority).toBe(StandardPriority.override);
    expect(s.priority).toBe(100);
  });

  it("read() resolves to the exact value passed (referential equality)", async () => {
    const value = { nested: { x: 1 } };
    const s = overrideSource(value);
    await expect(s.read()).resolves.toBe(value);
  });

  it("respects custom name and priority via options", () => {
    const s = overrideSource({ a: 1 }, { name: "cli", priority: 200 });
    expect(s.name).toBe("cli");
    expect(s.priority).toBe(200);
  });

  it("passes undefined through unmodified", async () => {
    const s = overrideSource(undefined);
    await expect(s.read()).resolves.toBeUndefined();
  });

  it("passes null through unmodified", async () => {
    const s = overrideSource(null);
    await expect(s.read()).resolves.toBeNull();
  });

  it("does not define a watch property", () => {
    const s = overrideSource({});
    expect(s.watch).toBeUndefined();
  });

  it("does not set arrayMerge", () => {
    const s = overrideSource({});
    expect(s.arrayMerge).toBeUndefined();
  });
});

describe("defaultsSource", () => {
  it("uses name='default' and priority=0 by default", () => {
    const s = defaultsSource({ a: 1 });
    expect(s.name).toBe("default");
    expect(s.priority).toBe(StandardPriority.default);
    expect(s.priority).toBe(0);
  });

  it("read() resolves to the exact value passed (referential equality)", async () => {
    const value = { nested: { x: 1 } };
    const s = defaultsSource(value);
    await expect(s.read()).resolves.toBe(value);
  });

  it("respects custom name and priority via options", () => {
    const s = defaultsSource({ a: 1 }, { name: "fallback", priority: -10 });
    expect(s.name).toBe("fallback");
    expect(s.priority).toBe(-10);
  });

  it("passes undefined through unmodified", async () => {
    const s = defaultsSource(undefined);
    await expect(s.read()).resolves.toBeUndefined();
  });

  it("passes null through unmodified", async () => {
    const s = defaultsSource(null);
    await expect(s.read()).resolves.toBeNull();
  });

  it("does not define a watch property", () => {
    const s = defaultsSource({});
    expect(s.watch).toBeUndefined();
  });

  it("does not set arrayMerge", () => {
    const s = defaultsSource({});
    expect(s.arrayMerge).toBeUndefined();
  });
});

describe("flagsSource", () => {
  it("uses name='flag' and priority=75 by default", () => {
    const s = flagsSource({ a: 1 });
    expect(s.name).toBe("flag");
    expect(s.priority).toBe(StandardPriority.flag);
    expect(s.priority).toBe(75);
  });

  it("read() resolves to the exact value passed (referential equality)", async () => {
    const value = { port: 8080, verbose: true };
    const s = flagsSource(value);
    await expect(s.read()).resolves.toBe(value);
  });

  it("respects custom name and priority via options", () => {
    const s = flagsSource({ a: 1 }, { name: "argv", priority: 80 });
    expect(s.name).toBe("argv");
    expect(s.priority).toBe(80);
  });

  it("passes undefined through unmodified", async () => {
    const s = flagsSource(undefined);
    await expect(s.read()).resolves.toBeUndefined();
  });

  it("passes null through unmodified", async () => {
    const s = flagsSource(null);
    await expect(s.read()).resolves.toBeNull();
  });

  it("does not define a watch property", () => {
    const s = flagsSource({});
    expect(s.watch).toBeUndefined();
  });

  it("does not set arrayMerge", () => {
    const s = flagsSource({});
    expect(s.arrayMerge).toBeUndefined();
  });
});
