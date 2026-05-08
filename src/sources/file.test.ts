import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ParseError, isParseError } from "../errors.js";
import { defaultRegistry } from "../parsers/registry.js";
import type { Runtime } from "../types.js";
import { StandardPriority } from "../types.js";
import { fileSource } from "./file.js";

describe("fileSource", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "confetti-file-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads + parses a JSON file", async () => {
    const p = join(dir, "config.json");
    await writeFile(p, JSON.stringify({ port: 8080, debug: true }), "utf8");

    const src = fileSource({ path: p });
    const result = await src.read();

    expect(result).toEqual({ port: 8080, debug: true });
  });

  it("detects format from .json extension", async () => {
    const p = join(dir, "settings.json");
    await writeFile(p, '{"a":1}', "utf8");

    const src = fileSource({ path: p });
    expect(await src.read()).toEqual({ a: 1 });
  });

  it("explicit format overrides missing extension", async () => {
    const p = join(dir, "data"); // no extension
    await writeFile(p, '{"x":42}', "utf8");

    const src = fileSource({ path: p, format: "json" });
    expect(await src.read()).toEqual({ x: 42 });
  });

  it("explicit format overrides extension detection", async () => {
    const p = join(dir, "weird.txt"); // .txt would fail extension lookup
    await writeFile(p, '{"y":7}', "utf8");

    const src = fileSource({ path: p, format: "json" });
    expect(await src.read()).toEqual({ y: 7 });
  });

  it("wraps parse errors in ParseError with sourcePath, parserName, and cause", async () => {
    const p = join(dir, "bad.json");
    await writeFile(p, "{not valid json", "utf8");

    const src = fileSource({ path: p });

    let caught: unknown;
    try {
      await src.read();
    } catch (err) {
      caught = err;
    }

    expect(isParseError(caught)).toBe(true);
    const pe = caught as ParseError;
    expect(pe.sourcePath).toBe(p);
    expect(pe.parserName).toBe("json");
    expect(pe.cause).toBeInstanceOf(SyntaxError);
  });

  it("throws clear error mentioning the unknown extension", () => {
    expect(() => fileSource({ path: "config.xyz" })).toThrowError(/xyz/);
  });

  it("returns undefined when optional:true and file is missing", async () => {
    const p = join(dir, "does-not-exist.json");
    const src = fileSource({ path: p, optional: true });

    await expect(src.read()).resolves.toBeUndefined();
  });

  it("throws when optional is false (default) and file is missing", async () => {
    const p = join(dir, "missing.json");
    const src = fileSource({ path: p });

    await expect(src.read()).rejects.toThrow();
  });

  it("does NOT suppress parse errors even when optional:true", async () => {
    const p = join(dir, "broken.json");
    await writeFile(p, "{{{not json", "utf8");
    const src = fileSource({ path: p, optional: true });

    await expect(src.read()).rejects.toBeInstanceOf(ParseError);
  });

  it("uses a custom runtime when provided", async () => {
    let calls = 0;
    const fake: Runtime = {
      async readFile(path: string): Promise<string> {
        calls++;
        expect(path).toBe("/virtual/cfg.json");
        return '{"from":"fake"}';
      },
      readEnv: () => undefined,
      listEnv: () => ({}),
    };

    const src = fileSource({ path: "/virtual/cfg.json", runtime: fake });
    expect(await src.read()).toEqual({ from: "fake" });
    expect(calls).toBe(1);
  });

  it("uses a custom parser registry when provided", async () => {
    const customParser = {
      extensions: ["custom"] as const,
      parse(raw: string): unknown {
        return { raw };
      },
    };
    const reg = defaultRegistry();
    reg.set("custom", customParser);

    const fake: Runtime = {
      async readFile(): Promise<string> {
        return "hello world";
      },
      readEnv: () => undefined,
      listEnv: () => ({}),
    };

    const src = fileSource({
      path: "/v/file.custom",
      parsers: reg,
      runtime: fake,
    });
    expect(await src.read()).toEqual({ raw: "hello world" });
  });

  it("default name is `file:${basename}` and priority is StandardPriority.file", async () => {
    const p = join(dir, "app.json");
    await writeFile(p, "{}", "utf8");
    const src = fileSource({ path: p });

    expect(src.name).toBe("file:app.json");
    expect(src.priority).toBe(StandardPriority.file);
    expect(src.priority).toBe(25);
  });

  it("honours custom name and priority overrides", async () => {
    const p = join(dir, "x.json");
    await writeFile(p, "{}", "utf8");
    const src = fileSource({ path: p, name: "my-cfg", priority: 99 });

    expect(src.name).toBe("my-cfg");
    expect(src.priority).toBe(99);
  });

  it("propagates non-ENOENT read errors even when optional:true", async () => {
    const fake: Runtime = {
      async readFile(): Promise<string> {
        throw new Error("EACCES: permission denied");
      },
      readEnv: () => undefined,
      listEnv: () => ({}),
    };
    const src = fileSource({
      path: "/locked.json",
      optional: true,
      runtime: fake,
    });

    await expect(src.read()).rejects.toThrow(/EACCES/);
  });

  it("surfaces ParseError with the format key as parserName when format is overridden", async () => {
    const p = join(dir, "weird"); // no extension
    await writeFile(p, "not json", "utf8");

    const src = fileSource({ path: p, format: "json" });
    let caught: unknown;
    try {
      await src.read();
    } catch (err) {
      caught = err;
    }
    expect(isParseError(caught)).toBe(true);
    expect((caught as ParseError).parserName).toBe("json");
    expect((caught as ParseError).sourcePath).toBe(p);
  });

  it("passes arrayMerge through to the Source", async () => {
    const p = join(dir, "arr.json");
    await writeFile(p, "{}", "utf8");
    const src = fileSource({ path: p, arrayMerge: "concat" });

    expect(src.arrayMerge).toBe("concat");
  });
});
