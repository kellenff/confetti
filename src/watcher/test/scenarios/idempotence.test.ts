import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Runtime, Unwatch } from "../../../types.js";
import { watchFile } from "../../index.js";

// Deterministic idempotence + error-forwarding scenarios. Same approach as
// debounce.test.ts — fake runtime + fake timers, no fs.watch involvement.

const DEBOUNCE_MS = 100;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchFile idempotence + error forwarding (fake timers)", () => {
  it("multiple unwatch calls invoke inner unwatch exactly once", async () => {
    let innerCalls = 0;
    const runtime: Runtime = {
      readFile: async () => "",
      readEnv: () => undefined,
      listEnv: () => ({}),
      watchPath: (): Unwatch => () => {
        innerCalls++;
      },
    };

    const unwatch = await watchFile("anywhere", () => {}, {
      debounceMs: DEBOUNCE_MS,
      runtime,
      resolveSymlinks: false,
    });

    await unwatch();
    await unwatch();
    await unwatch();

    expect(innerCalls).toBe(1);
  });

  it("forwards inner-unwatch error to onError; second unwatch is a no-op", async () => {
    const boom = new Error("inner unwatch boom");
    let innerCalls = 0;
    const runtime: Runtime = {
      readFile: async () => "",
      readEnv: () => undefined,
      listEnv: () => ({}),
      watchPath: (): Unwatch => () => {
        innerCalls++;
        throw boom;
      },
    };
    const errors: unknown[] = [];

    const unwatch = await watchFile("anywhere", () => {}, {
      debounceMs: DEBOUNCE_MS,
      runtime,
      resolveSymlinks: false,
      onError: (err) => errors.push(err),
    });

    await unwatch();
    await unwatch();

    expect(innerCalls).toBe(1);
    expect(errors).toEqual([boom]);
  });

  it("rejects with a clear error when runtime has no watchPath", async () => {
    const runtime: Runtime = {
      readFile: async () => "",
      readEnv: () => undefined,
      listEnv: () => ({}),
    };

    await expect(
      watchFile("anywhere", () => {}, {
        runtime,
        resolveSymlinks: false,
      }),
    ).rejects.toThrow(/no watchPath/);
  });

  it("forwards handler errors thrown inside the debounced timeout to onError", async () => {
    let trigger: (() => void) | undefined;
    const runtime: Runtime = {
      readFile: async () => "",
      readEnv: () => undefined,
      listEnv: () => ({}),
      watchPath: (_path, h): Unwatch => {
        trigger = h;
        return () => {};
      },
    };
    const errors: unknown[] = [];
    const handlerErr = new Error("handler boom");

    const unwatch = await watchFile(
      "anywhere",
      () => {
        throw handlerErr;
      },
      {
        debounceMs: DEBOUNCE_MS,
        runtime,
        resolveSymlinks: false,
        onError: (err) => errors.push(err),
      },
    );

    expect(trigger).toBeDefined();
    trigger?.();
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(errors).toEqual([handlerErr]);
    await unwatch();
  });
});
