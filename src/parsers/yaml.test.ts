import { describe, it, expect } from "vitest";
import { loadYamlParser } from "./yaml.js";
import { yamlStaticParser } from "./yaml-static.js";

describe("yaml parser (lazy + static variants)", () => {
  it("both expose extensions ['yaml', 'yml']", async () => {
    const lazy = await loadYamlParser();
    expect(lazy.extensions).toEqual(["yaml", "yml"]);
    expect(yamlStaticParser.extensions).toEqual(["yaml", "yml"]);
  });

  it("both parse a basic YAML document identically", async () => {
    const raw = "server:\n  port: 3000\n  host: localhost\n";
    const expected = { server: { port: 3000, host: "localhost" } };
    const lazy = await loadYamlParser();
    expect(lazy.parse(raw)).toEqual(expected);
    expect(yamlStaticParser.parse(raw)).toEqual(expected);
  });

  it("both handle empty string identically", async () => {
    const lazy = await loadYamlParser();
    expect(lazy.parse("")).toEqual(yamlStaticParser.parse(""));
  });

  it("parses multi-line strings, lists, and nested objects", async () => {
    const raw = [
      "name: confetti",
      "tags:",
      "  - config",
      "  - layered",
      "description: |",
      "  line one",
      "  line two",
      "nested:",
      "  a:",
      "    b: 1",
      "    c: [2, 3]",
      "",
    ].join("\n");
    const expected = {
      name: "confetti",
      tags: ["config", "layered"],
      description: "line one\nline two\n",
      nested: { a: { b: 1, c: [2, 3] } },
    };
    const lazy = await loadYamlParser();
    expect(lazy.parse(raw)).toEqual(expected);
    expect(yamlStaticParser.parse(raw)).toEqual(expected);
  });

  it("propagates errors on invalid YAML (lazy)", async () => {
    const lazy = await loadYamlParser();
    expect(() => lazy.parse("foo: [unclosed")).toThrow();
  });

  it("propagates errors on invalid YAML (static)", () => {
    expect(() => yamlStaticParser.parse("foo: [unclosed")).toThrow();
  });

  it("loadYamlParser caches and returns the same instance", async () => {
    const a = await loadYamlParser();
    const b = await loadYamlParser();
    expect(a).toBe(b);
  });

  it("lazy and static produce equivalent output across multiple inputs", async () => {
    const lazy = await loadYamlParser();
    const inputs = [
      "x: 1\ny: 2\n",
      "items:\n  - a\n  - b\n  - c\n",
      "deeply:\n  nested:\n    map:\n      n: null\n      b: true\n      f: 3.14\n",
    ];
    for (const raw of inputs) {
      expect(lazy.parse(raw)).toEqual(yamlStaticParser.parse(raw));
    }
  });
});
