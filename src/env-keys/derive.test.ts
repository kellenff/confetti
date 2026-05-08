import { describe, expect, it } from "vitest";

import { deriveEnvKeys, type EnvKeyMapping } from "./derive.js";
import type { SchemaLeaf } from "./walker.js";

/** Build a minimal SchemaLeaf for tests. inputType defaults to 'string'. */
function leaf(
  path: readonly string[],
  overrides: Partial<SchemaLeaf> = {},
): SchemaLeaf {
  return {
    path,
    inputType: "string",
    optional: false,
    hasDefault: false,
    ...overrides,
  };
}

describe("deriveEnvKeys — example table", () => {
  it.each<[string, string, readonly string[], string]>([
    ["APP_", "__", ["server", "port"], "APP_SERVER__PORT"],
    ["APP_", "__", ["logLevel"], "APP_LOG_LEVEL"],
    ["", "__", ["db", "maxConn"], "DB__MAX_CONN"],
    ["MY_", "_", ["a", "b", "c"], "MY_A_B_C"],
    ["APP_", "__", ["feature-flag"], "APP_FEATURE_FLAG"],
    ["APP_", "__", ["my_var"], "APP_MY_VAR"],
    ["APP_", "__", ["items", "0"], "APP_ITEMS__0"],
    ["APP_", "__", ["XMLHttpRequest"], "APP_XML_HTTP_REQUEST"],
  ])(
    "prefix=%j sep=%j path=%j → envName=%j",
    (prefix, separator, path, expected) => {
      const [out] = deriveEnvKeys([leaf(path)], { prefix, separator });
      expect(out?.envName).toBe(expected);
    },
  );
});

describe("deriveEnvKeys — basic semantics", () => {
  it("empty leaves → empty array", () => {
    expect(deriveEnvKeys([])).toEqual([]);
  });

  it("default options: no prefix, separator='__'", () => {
    const out = deriveEnvKeys([leaf(["server", "port"])]);
    expect(out[0]?.envName).toBe("SERVER__PORT");
  });

  it("preserves original path identity for downstream merge", () => {
    const path = ["server", "port"] as const;
    const input = leaf(path);
    const [out] = deriveEnvKeys([input]);
    // path is structurally equal to the leaf's path.
    expect(out?.path).toEqual(path);
    // And references the same leaf descriptor (so callers can coerce).
    expect(out?.leaf).toBe(input);
  });

  it("returns mappings in input order", () => {
    const inputs = [leaf(["a"]), leaf(["b"]), leaf(["c"])];
    const out = deriveEnvKeys(inputs);
    expect(out.map((m) => m.envName)).toEqual(["A", "B", "C"]);
  });
});

describe("deriveEnvKeys — empty prefix / empty separator", () => {
  it("empty prefix: no prefix prepended", () => {
    const [out] = deriveEnvKeys([leaf(["foo"])], { prefix: "" });
    expect(out?.envName).toBe("FOO");
  });

  it("empty separator: segments concatenated directly", () => {
    const [out] = deriveEnvKeys([leaf(["a", "b"])], {
      prefix: "",
      separator: "",
    });
    expect(out?.envName).toBe("AB");
  });

  it("empty separator with multi-segment camelCase", () => {
    const [out] = deriveEnvKeys([leaf(["logLevel", "max"])], {
      prefix: "X_",
      separator: "",
    });
    expect(out?.envName).toBe("X_LOG_LEVELMAX");
  });
});

describe("deriveEnvKeys — acronym handling", () => {
  // The two-pass algorithm splits `IPv4Address` as `I_Pv4_Address` because
  // the acronym pass sees `IPv` and breaks `[A-Z]+[A-Z][a-z]` → `I` + `Pv`.
  // This is the same well-known limitation that change-case / lodash share
  // for two-letter acronyms followed by a lowercase letter (TCP, IO, etc.).
  // Documented here so the behaviour is intentional, not accidental.
  it.each<[string, string]>([
    ["IPv4Address", "I_PV4_ADDRESS"],
    ["parseURLPath", "PARSE_URL_PATH"],
    ["version2Beta", "VERSION2_BETA"],
    ["XMLHttpRequest", "XML_HTTP_REQUEST"],
  ])("%s → %s", (segment, expected) => {
    const [out] = deriveEnvKeys([leaf([segment])]);
    expect(out?.envName).toBe(expected);
  });

  it("all-uppercase input passes through unchanged", () => {
    const [out] = deriveEnvKeys([leaf(["DATABASE", "URL"])]);
    expect(out?.envName).toBe("DATABASE__URL");
  });

  it("mixed-case path with numerics: id42 stays attached", () => {
    const [out] = deriveEnvKeys([leaf(["user", "id42"])]);
    expect(out?.envName).toBe("USER__ID42");
  });

  it("digit-then-uppercase splits", () => {
    // Digit boundary is treated as lowercase-equivalent for splitting.
    const [out] = deriveEnvKeys([leaf(["v2Api"])]);
    expect(out?.envName).toBe("V2_API");
  });
});

describe("deriveEnvKeys — defensive segment normalisation", () => {
  it("dotted segment is split (defensive — walker should not emit this)", () => {
    const [out] = deriveEnvKeys([leaf(["a.b"])], {
      prefix: "",
      separator: "__",
    });
    expect(out?.envName).toBe("A_B");
  });

  it("preserves existing underscores", () => {
    const [out] = deriveEnvKeys([leaf(["already_snake_case"])]);
    expect(out?.envName).toBe("ALREADY_SNAKE_CASE");
  });
});

describe("deriveEnvKeys — leaf passthrough", () => {
  it("array leaf at a path uses the same envName as a primitive there", () => {
    const arrLeaf: SchemaLeaf = {
      path: ["tags"],
      inputType: "array",
      optional: false,
      hasDefault: false,
      itemType: "string",
    };
    const [out] = deriveEnvKeys([arrLeaf], { prefix: "APP_" });
    expect(out?.envName).toBe("APP_TAGS");
    expect(out?.leaf.inputType).toBe("array");
    expect(out?.leaf.itemType).toBe("string");
  });

  it("does NOT throw on duplicate envNames from divergent paths (caller's responsibility)", () => {
    const inputs = [leaf(["apiUrl"]), leaf(["api_url"])];
    const out = deriveEnvKeys(inputs);
    expect(out).toHaveLength(2);
    expect(out[0]?.envName).toBe("API_URL");
    expect(out[1]?.envName).toBe("API_URL");
    // Both retain their original paths so caller can detect/resolve.
    expect(out[0]?.path).toEqual(["apiUrl"]);
    expect(out[1]?.path).toEqual(["api_url"]);
  });
});

describe("deriveEnvKeys — return shape", () => {
  it("EnvKeyMapping has envName, path, leaf", () => {
    const input = leaf(["x"]);
    const [out] = deriveEnvKeys([input]);
    const expected: EnvKeyMapping = {
      envName: "X",
      path: ["x"],
      leaf: input,
    };
    expect(out).toEqual(expected);
  });
});
