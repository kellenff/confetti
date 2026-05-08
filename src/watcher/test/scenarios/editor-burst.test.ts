import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchFile } from "../../index.js";

// Real-fs scenario simulating an editor save burst — write, stat, then a
// few quick re-writes within ~30ms. The 75ms debounce should coalesce all
// of those events into a single handler call.

// Bumped from 75ms to absorb macOS fs.watch duplicate-event variance under
// CI load. The deterministic =1-call coalescing assertion lives in
// scenarios/debounce.test.ts (fake timers); this real-fs test verifies the
// integration path without staking the suite on event-delivery timing.
const DEBOUNCE_MS = 200;
const SETTLE_MS = 350;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "confetti-watcher-burst-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("editor-burst scenario (real fs)", () => {
  it("coalesces an editor save burst into a single handler call", async () => {
    const path = join(tmpDir, "config.json");
    await writeFile(path, "0");

    let calls = 0;
    const unwatch = await watchFile(path, () => calls++, {
      debounceMs: DEBOUNCE_MS,
    });

    await wait(20);

    // Editor-save shape: initial write, a stat (for "did it change"), and
    // a few rapid follow-up writes — all within the 75ms debounce window.
    await writeFile(path, "1");
    await stat(path);
    await wait(10);
    await writeFile(path, "2");
    await wait(10);
    await writeFile(path, "3");

    await wait(SETTLE_MS);

    // Tolerant assertion: with a 200ms debounce and ~30ms burst, we EXPECT
    // exactly 1 call but allow 2 to absorb CI-runner variance. The strict
    // contract is asserted in scenarios/debounce.test.ts via fake timers.
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);
    await unwatch();
  });
});
