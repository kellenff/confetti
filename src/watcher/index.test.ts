import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Runtime, Unwatch } from "../types.js";
import { watchFile } from "./index.js";

// Use a short debounce in tests to keep them fast.
const DEBOUNCE_MS = 25;
const SETTLE_MS = DEBOUNCE_MS + 25;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "confetti-watcher-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("watchFile", () => {
  it("fires handler once after a single change", async () => {
    const path = join(tmpDir, "config.json");
    await writeFile(path, "1");
    let calls = 0;
    const unwatch = await watchFile(path, () => calls++, {
      debounceMs: DEBOUNCE_MS,
    });

    await wait(10); // let the watcher settle
    await writeFile(path, "2");
    await wait(SETTLE_MS);

    expect(calls).toBe(1);
    await unwatch();
  });

  it("coalesces burst events into a single call", async () => {
    const path = join(tmpDir, "config.json");
    await writeFile(path, "0");
    let calls = 0;
    const unwatch = await watchFile(path, () => calls++, {
      debounceMs: DEBOUNCE_MS,
    });

    await wait(10);
    // Five rapid writes within the debounce window. Issued in parallel so
    // they land as a burst of fs events without serializing on each other.
    await Promise.all([1, 2, 3, 4, 5].map((i) => writeFile(path, String(i))));
    await wait(SETTLE_MS);

    expect(calls).toBe(1);
    await unwatch();
  });

  it("stops firing after unwatch", async () => {
    const path = join(tmpDir, "config.json");
    await writeFile(path, "0");
    let calls = 0;
    const unwatch = await watchFile(path, () => calls++, {
      debounceMs: DEBOUNCE_MS,
    });

    await wait(10);
    await unwatch();
    await writeFile(path, "1");
    await wait(SETTLE_MS);

    expect(calls).toBe(0);
  });

  it("idempotent unwatch — second call does nothing and does not throw", async () => {
    const path = join(tmpDir, "config.json");
    await writeFile(path, "0");
    let unwatchInnerCalls = 0;
    const fakeRuntime: Runtime = {
      readFile: async () => "",
      readEnv: () => undefined,
      listEnv: () => ({}),
      watchPath: () => () => {
        unwatchInnerCalls++;
      },
    };
    const unwatch = await watchFile(path, () => {}, {
      debounceMs: DEBOUNCE_MS,
      runtime: fakeRuntime,
      resolveSymlinks: false,
    });

    await unwatch();
    await unwatch(); // second call should be a no-op
    expect(unwatchInnerCalls).toBe(1);
  });

  it("does not fire if the debounce timer is still pending when unwatch is called", async () => {
    const path = join(tmpDir, "config.json");
    await writeFile(path, "0");
    let calls = 0;
    const unwatch = await watchFile(path, () => calls++, {
      debounceMs: DEBOUNCE_MS,
    });

    await wait(10);
    await writeFile(path, "1");
    // Unwatch BEFORE debounce timer fires.
    await unwatch();
    await wait(SETTLE_MS);

    expect(calls).toBe(0);
  });

  it("works with resolveSymlinks: false (smoke)", async () => {
    const path = join(tmpDir, "config.json");
    await writeFile(path, "0");
    let calls = 0;
    const unwatch = await watchFile(path, () => calls++, {
      debounceMs: DEBOUNCE_MS,
      resolveSymlinks: false,
    });

    await wait(10);
    await writeFile(path, "1");
    await wait(SETTLE_MS);

    expect(calls).toBe(1);
    await unwatch();
  });

  it("throws clearly when runtime has no watchPath", async () => {
    const fakeRuntime: Runtime = {
      readFile: async () => "",
      readEnv: () => undefined,
      listEnv: () => ({}),
    };
    await expect(
      watchFile("anywhere", () => {}, { runtime: fakeRuntime }),
    ).rejects.toThrow(/no watchPath/);
  });

  it("forwards errors thrown by the inner unwatch to onError", async () => {
    const boom = new Error("inner unwatch boom");
    const innerUnwatch: Unwatch = () => {
      throw boom;
    };
    const fakeRuntime: Runtime = {
      readFile: async () => "",
      readEnv: () => undefined,
      listEnv: () => ({}),
      watchPath: () => innerUnwatch,
    };
    const errors: unknown[] = [];
    const unwatch = await watchFile("anywhere", () => {}, {
      runtime: fakeRuntime,
      resolveSymlinks: false,
      onError: (err) => errors.push(err),
    });
    await unwatch();
    expect(errors).toEqual([boom]);
  });

  it("forwards errors thrown by the user handler to onError", async () => {
    // Drive this with a fake runtime so the test doesn't depend on fs event
    // timing (which is flaky under load when several watcher tests run in
    // parallel). We just need to prove: handler throws -> onError receives.
    let trigger: (() => void) | undefined;
    const fakeRuntime: Runtime = {
      readFile: async () => "",
      readEnv: () => undefined,
      listEnv: () => ({}),
      watchPath: (_path, h) => {
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
        runtime: fakeRuntime,
        resolveSymlinks: false,
        onError: (err) => errors.push(err),
      },
    );
    expect(trigger).toBeDefined();
    trigger?.();
    await wait(SETTLE_MS);

    expect(errors).toEqual([handlerErr]);
    await unwatch();
  });
});
