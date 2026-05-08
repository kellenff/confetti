import { describe, expect, it } from "vitest";
import {
  AggregatedConfigError,
  type ConfigIssue,
  isAggregatedConfigError,
  isParseError,
  ParseError,
} from "./errors.js";

describe("AggregatedConfigError", () => {
  it("constructs with empty issues", () => {
    const err = new AggregatedConfigError([]);
    expect(err.issues).toEqual([]);
    expect(err.message).toContain("no issues recorded");
    expect(err.name).toBe("AggregatedConfigError");
  });

  it("formats message with issue count and per-issue lines", () => {
    const issues: ConfigIssue[] = [
      {
        path: ["server", "port"],
        message: "Expected number",
        source: "env",
        code: "invalid_type",
      },
      { path: [], message: "Missing root", source: "merged" },
    ];
    const err = new AggregatedConfigError(issues);
    expect(err.message).toContain("2 issues");
    expect(err.message).toContain("server.port");
    expect(err.message).toContain("[env]");
    expect(err.message).toContain("(root)");
    expect(err.message).toContain("[merged]");
  });

  it("uses singular form for a single issue", () => {
    const err = new AggregatedConfigError([
      { path: ["x"], message: "bad", source: "file" },
    ]);
    expect(err.message).toContain("1 issue)");
    expect(err.message).not.toContain("1 issues");
  });

  it("preserves cause via Error.cause", () => {
    const root = new Error("boom");
    const err = new AggregatedConfigError(
      [{ path: ["x"], message: "m", source: "file" }],
      { cause: root },
    );
    expect(err.cause).toBe(root);
  });

  it("accepts standard SourceName values", () => {
    const issues: ConfigIssue[] = [
      { path: ["a"], message: "a", source: "default" },
      { path: ["b"], message: "b", source: "file" },
      { path: ["c"], message: "c", source: "env" },
      { path: ["d"], message: "d", source: "flag" },
      { path: ["e"], message: "e", source: "override" },
      { path: ["f"], message: "f", source: "merged" },
    ];
    const err = new AggregatedConfigError(issues);
    expect(err.issues).toHaveLength(6);
  });

  it("accepts arbitrary user-defined source strings", () => {
    const issues: ConfigIssue[] = [
      { path: ["a"], message: "a", source: "aws-secrets" },
      { path: ["b"], message: "b", source: "vault://prod" },
    ];
    const err = new AggregatedConfigError(issues);
    expect(err.issues[0]?.source).toBe("aws-secrets");
    expect(err.issues[1]?.source).toBe("vault://prod");
  });

  it("is an Error subclass", () => {
    const err = new AggregatedConfigError([]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AggregatedConfigError);
  });
});

describe("isAggregatedConfigError", () => {
  it("returns true for AggregatedConfigError instances", () => {
    expect(isAggregatedConfigError(new AggregatedConfigError([]))).toBe(true);
  });

  it("returns false for plain Error", () => {
    expect(isAggregatedConfigError(new Error("nope"))).toBe(false);
  });

  it("returns false for ParseError", () => {
    const pe = new ParseError("x", { sourcePath: "/a", parserName: "json" });
    expect(isAggregatedConfigError(pe)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isAggregatedConfigError(undefined)).toBe(false);
    expect(isAggregatedConfigError(null)).toBe(false);
    expect(isAggregatedConfigError("string")).toBe(false);
    expect(isAggregatedConfigError({ issues: [] })).toBe(false);
  });
});

describe("ParseError", () => {
  it("preserves sourcePath, parserName, and message", () => {
    const err = new ParseError("bad json", {
      sourcePath: "/etc/cfg.json",
      parserName: "json",
    });
    expect(err.sourcePath).toBe("/etc/cfg.json");
    expect(err.parserName).toBe("json");
    expect(err.message).toBe("bad json");
    expect(err.name).toBe("ParseError");
  });

  it("preserves cause when supplied", () => {
    const root = new SyntaxError("Unexpected token");
    const err = new ParseError("bad", {
      sourcePath: "/a",
      parserName: "json",
      cause: root,
    });
    expect(err.cause).toBe(root);
  });

  it("omits cause when not supplied", () => {
    const err = new ParseError("bad", { sourcePath: "/a", parserName: "json" });
    expect(err.cause).toBeUndefined();
  });
});

describe("isParseError", () => {
  it("returns true for ParseError instances", () => {
    expect(
      isParseError(
        new ParseError("x", { sourcePath: "/a", parserName: "json" }),
      ),
    ).toBe(true);
  });

  it("returns false for AggregatedConfigError", () => {
    expect(isParseError(new AggregatedConfigError([]))).toBe(false);
  });

  it("returns false for plain Error", () => {
    expect(isParseError(new Error("nope"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isParseError(undefined)).toBe(false);
    expect(isParseError(null)).toBe(false);
    expect(isParseError({})).toBe(false);
  });
});
