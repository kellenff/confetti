import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchFile } from "../../index.js";

// Real-fs scenario simulating an editor save burst — write, stat, then a
// few quick re-writes within ~30ms. The 75ms debounce should coalesce all
// of those events into a single handler call.

const DEBOUNCE_MS = 75;
const SETTLE_MS = 200;

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

    // Strict assertion: every event in this burst lands inside one debounce
    // window, so there must be exactly one handler call.
    expect(calls).toBe(1);
    await unwatch();
  });
});
