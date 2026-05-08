import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeRuntime } from "./node.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "confetti-node-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("nodeRuntime", () => {
  it("reads a UTF-8 file", async () => {
    const path = join(tmpDir, "test.txt");
    await writeFile(path, "hello", "utf8");
    expect(await nodeRuntime.readFile(path)).toBe("hello");
  });

  it("reads env vars", () => {
    process.env.CONFETTI_TEST = "1";
    try {
      expect(nodeRuntime.readEnv("CONFETTI_TEST")).toBe("1");
      expect(nodeRuntime.readEnv("CONFETTI_NOT_SET")).toBeUndefined();
    } finally {
      delete process.env.CONFETTI_TEST;
    }
  });

  it("lists env vars by prefix preserving original case", () => {
    process.env.APP_FOO = "1";
    process.env.APP_Bar = "2";
    process.env.OTHER = "3";
    try {
      const got = nodeRuntime.listEnv("APP_");
      expect(got).toEqual({ APP_FOO: "1", APP_Bar: "2" });
      expect(got).not.toHaveProperty("OTHER");
    } finally {
      delete process.env.APP_FOO;
      delete process.env.APP_Bar;
      delete process.env.OTHER;
    }
  });
});
