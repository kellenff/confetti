import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchFile } from "./index.js";

// End-to-end smoke test that exercises the real Node fs.watch path. All
// deterministic behaviour (debounce, idempotence, error forwarding) lives
// in src/watcher/test/scenarios/* with fake timers; this file is just the
// "wires connect" check. macOS fs.watch can emit duplicate events 50+ ms
// apart for a single write, so we use a generous debounce + settle window
// to absorb that variance and let the smoke test stay deterministic.
const DEBOUNCE_MS = 100;
const SETTLE_MS = 200;

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
});
