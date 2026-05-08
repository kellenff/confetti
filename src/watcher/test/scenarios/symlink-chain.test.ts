import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchFile } from "../../index.js";

// Real-fs scenario verifying symlink resolution at watch start: watching
// `link.json` should track changes to its realpath target.

const DEBOUNCE_MS = 75;
const SETTLE_MS = 200;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "confetti-watcher-symlink-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("symlink-chain scenario (real fs)", () => {
  it("watching a symlink fires handler when the link target changes", async () => {
    const target = join(tmpDir, "target.json");
    const link = join(tmpDir, "link.json");
    await writeFile(target, "1");
    await symlink(target, link);

    let calls = 0;
    const unwatch = await watchFile(link, () => calls++, {
      debounceMs: DEBOUNCE_MS,
    });

    await wait(20);
    await writeFile(target, "2");
    await wait(SETTLE_MS);

    expect(calls).toBeGreaterThanOrEqual(1);
    await unwatch();
  });
});
