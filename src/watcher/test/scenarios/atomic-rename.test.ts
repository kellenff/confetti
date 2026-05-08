import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watchFile } from "../../index.js";

// Real-fs scenario for SC7 (atomic-rename detection). Many editors save
// via "write tmp file -> rename onto target", which orphans naive watchers
// pointed at the inode. The runtime watches the parent dir, so the rename
// must produce at least one debounced handler call.

const DEBOUNCE_MS = 75;
const SETTLE_MS = 200;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "confetti-watcher-rename-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("atomic-rename scenario (real fs)", () => {
  it("fires handler after `mv tmp config.json` atomic replace", async () => {
    const target = join(tmpDir, "config.json");
    const tmpFile = join(tmpDir, "config.json.tmp");
    await writeFile(target, "1");

    let calls = 0;
    const unwatch = await watchFile(target, () => calls++, {
      debounceMs: DEBOUNCE_MS,
    });

    // Let the watcher attach.
    await wait(20);

    await writeFile(tmpFile, "2");
    await rename(tmpFile, target);

    await wait(SETTLE_MS);

    // Tolerate platform variance: some platforms may emit only a directory
    // event, others both a directory and target event. The contract is
    // "at least one debounced fire", coalesced into a single batch.
    expect(calls).toBeGreaterThanOrEqual(1);
    await unwatch();
  });
});
