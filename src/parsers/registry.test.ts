import { describe, expect, it } from "vitest";
import {
  defaultRegistry,
  getParser,
  registerParser,
  withInjectedParsers,
} from "./registry.js";
import { jsonParser } from "./json.js";
import type { Parser } from "../types.js";

const fakeYaml: Parser = {
  extensions: ["yaml", "yml"],
  parse: () => ({ ok: true }),
};

describe("defaultRegistry", () => {
  it("includes the json parser under .json", () => {
    const reg = defaultRegistry();
    expect(getParser(reg, "json")).toBe(jsonParser);
  });
});

describe("registerParser", () => {
  it("registers all extensions", () => {
    const reg = defaultRegistry();
    registerParser(reg, fakeYaml);
    expect(getParser(reg, "yaml")).toBe(fakeYaml);
    expect(getParser(reg, "yml")).toBe(fakeYaml);
  });

  it("lowercases extension keys", () => {
    const reg = defaultRegistry();
    registerParser(reg, { extensions: ["TXT"], parse: () => null });
    expect(getParser(reg, "txt")).toBeDefined();
    expect(getParser(reg, "TXT")).toBeDefined();
  });

  it("overrides on conflict", () => {
    const reg = defaultRegistry();
    const replacement: Parser = { extensions: ["json"], parse: () => "x" };
    registerParser(reg, replacement);
    expect(getParser(reg, "json")).toBe(replacement);
  });
});

describe("withInjectedParsers", () => {
  it("overlays injected parsers under format names", () => {
    const base = defaultRegistry();
    const reg = withInjectedParsers(base, { yaml: fakeYaml });
    expect(getParser(reg, "yaml")).toBe(fakeYaml);
    expect(getParser(reg, "yml")).toBe(fakeYaml);
  });

  it("does not mutate the base registry", () => {
    const base = defaultRegistry();
    withInjectedParsers(base, { yaml: fakeYaml });
    expect(() => getParser(base, "yaml")).toThrow(/no parser/);
  });

  it("injected parser overrides existing key", () => {
    const base = defaultRegistry();
    const injectedJson: Parser = { extensions: ["json"], parse: () => "x" };
    const reg = withInjectedParsers(base, { json: injectedJson });
    expect(getParser(reg, "json")).toBe(injectedJson);
  });
});

describe("getParser", () => {
  it("throws a clear error with known formats listed when missing", () => {
    const reg = defaultRegistry();
    expect(() => getParser(reg, "yaml")).toThrow(/Known formats:/);
    expect(() => getParser(reg, "yaml")).toThrow(/json/);
  });

  it("error mentions injection and peer-dep paths", () => {
    const reg = defaultRegistry();
    try {
      getParser(reg, "toml");
    } catch (e) {
      expect((e as Error).message).toMatch(/parsers/);
      expect((e as Error).message).toMatch(/peer dep/);
    }
  });
});

describe("jsonParser", () => {
  it("parses valid JSON", () => {
    expect(jsonParser.parse('{"a":1}')).toEqual({ a: 1 });
    expect(jsonParser.parse("[1,2,3]")).toEqual([1, 2, 3]);
    expect(jsonParser.parse('"hi"')).toBe("hi");
  });

  it("throws SyntaxError on malformed JSON", () => {
    expect(() => jsonParser.parse("{bad}")).toThrow(SyntaxError);
  });

  it("declares .json as its extension", () => {
    expect(jsonParser.extensions).toEqual(["json"]);
  });
});
