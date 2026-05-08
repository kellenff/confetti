import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime, Unwatch } from "../../../types.js";
import { watchFile } from "../../index.js";

// Deterministic debounce + coalescing scenarios. We drive the watcher with
// a fake Runtime whose watchPath captures the trigger handler, and we use
// vi.useFakeTimers() to control debounce timing without touching the real
// fs.watch path. This eliminates the cold-run flake the real-fs smoke test
// in src/watcher/index.test.ts is vulnerable to.

const DEBOUNCE_MS = 100;

interface FakeWatch {
  readonly runtime: Runtime;
  readonly trigger: () => void;
  readonly unwatchCalls: () => number;
}

const buildFakeWatch = (): FakeWatch => {
  let captured: (() => void) | undefined;
  let unwatchCalls = 0;
  const runtime: Runtime = {
    readFile: async () => "",
    readEnv: () => undefined,
    listEnv: () => ({}),
    watchPath: (_path, h): Unwatch => {
      captured = h;
      return () => {
        unwatchCalls++;
      };
    },
  };
  return {
    runtime,
    trigger: () => {
      if (!captured) throw new Error("trigger not yet captured");
      captured();
    },
    unwatchCalls: () => unwatchCalls,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchFile debounce (fake timers)", () => {
  it("single trigger fires handler exactly once after debounceMs", async () => {
    const fake = buildFakeWatch();
    let calls = 0;
    const unwatch = await watchFile("anywhere", () => calls++, {
      debounceMs: DEBOUNCE_MS,
      runtime: fake.runtime,
      resolveSymlinks: false,
    });

    fake.trigger();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(calls).toBe(0);

    vi.advanceTimersByTime(1);
    expect(calls).toBe(1);

    await unwatch();
  });

  it("burst of 5 triggers within debounce coalesces to one handler call", async () => {
    const fake = buildFakeWatch();
    let calls = 0;
    const unwatch = await watchFile("anywhere", () => calls++, {
      debounceMs: DEBOUNCE_MS,
      runtime: fake.runtime,
      resolveSymlinks: false,
    });

    for (let i = 0; i < 5; i++) {
      fake.trigger();
      vi.advanceTimersByTime(10); // 10ms apart, well within debounce
    }
    // 50ms elapsed; advance the rest to fire the timer.
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(calls).toBe(1);
    await unwatch();
  });

  it("two bursts separated by > debounceMs produce two handler calls", async () => {
    const fake = buildFakeWatch();
    let calls = 0;
    const unwatch = await watchFile("anywhere", () => calls++, {
      debounceMs: DEBOUNCE_MS,
      runtime: fake.runtime,
      resolveSymlinks: false,
    });

    // Burst 1
    fake.trigger();
    fake.trigger();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(calls).toBe(1);

    // Burst 2 (debounce window has fully elapsed)
    fake.trigger();
    fake.trigger();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(calls).toBe(2);

    await unwatch();
  });

  it("trigger fired after unwatch is dropped", async () => {
    const fake = buildFakeWatch();
    let calls = 0;
    const unwatch = await watchFile("anywhere", () => calls++, {
      debounceMs: DEBOUNCE_MS,
      runtime: fake.runtime,
      resolveSymlinks: false,
    });

    await unwatch();
    expect(fake.unwatchCalls()).toBe(1);
    fake.trigger();
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);

    expect(calls).toBe(0);
  });

  it("pending debounce is cancelled by unwatch", async () => {
    const fake = buildFakeWatch();
    let calls = 0;
    const unwatch = await watchFile("anywhere", () => calls++, {
      debounceMs: DEBOUNCE_MS,
      runtime: fake.runtime,
      resolveSymlinks: false,
    });

    fake.trigger();
    vi.advanceTimersByTime(DEBOUNCE_MS / 2);
    await unwatch();
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(calls).toBe(0);
  });
});
