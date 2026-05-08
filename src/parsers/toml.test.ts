import { describe, expect, it } from "vitest";
import { loadTomlParser } from "./toml.js";
import { tomlStaticParser } from "./toml-static.js";

const BASIC_TOML = `[server]
port = 3000
host = "localhost"
`;

const RICH_TOML = `title = "TOML example"

[database]
enabled = true
ports = [8000, 8001, 8002]
connection = { host = "db.local", retries = 3 }

[[servers]]
name = "alpha"

[[servers]]
name = "beta"

[meta]
created = 1979-05-27T07:32:00Z
`;

describe("toml parsers (lazy + static)", () => {
  it("both expose extensions: ['toml']", async () => {
    const lazy = await loadTomlParser();
    expect(lazy.extensions).toEqual(["toml"]);
    expect(tomlStaticParser.extensions).toEqual(["toml"]);
  });

  it("both parse a basic TOML document identically", async () => {
    const lazy = await loadTomlParser();
    const lazyOut = lazy.parse(BASIC_TOML);
    const staticOut = tomlStaticParser.parse(BASIC_TOML);
    expect(lazyOut).toEqual({ server: { port: 3000, host: "localhost" } });
    expect(lazyOut).toEqual(staticOut);
  });

  it("both handle empty input consistently", async () => {
    const lazy = await loadTomlParser();
    const lazyOut = lazy.parse("");
    const staticOut = tomlStaticParser.parse("");
    expect(lazyOut).toEqual({});
    expect(staticOut).toEqual({});
    expect(lazyOut).toEqual(staticOut);
  });

  it("both pass through tables, arrays, inline tables, and dates", async () => {
    const lazy = await loadTomlParser();
    const lazyOut = lazy.parse(RICH_TOML) as Record<string, unknown>;
    const staticOut = tomlStaticParser.parse(RICH_TOML) as Record<
      string,
      unknown
    >;

    // Top-level
    expect(lazyOut.title).toBe("TOML example");

    // Table + array of primitives + inline table
    const database = lazyOut.database as {
      enabled: boolean;
      ports: number[];
      connection: { host: string; retries: number };
    };
    expect(database.enabled).toBe(true);
    expect(database.ports).toEqual([8000, 8001, 8002]);
    expect(database.connection).toEqual({ host: "db.local", retries: 3 });

    // Array of tables
    const servers = lazyOut.servers as Array<{ name: string }>;
    expect(servers).toEqual([{ name: "alpha" }, { name: "beta" }]);

    // Datetime — smol-toml returns Date objects for offset datetimes
    const meta = lazyOut.meta as { created: unknown };
    expect(meta.created).toBeInstanceOf(Date);

    // Equivalence between variants — Date instances compare structurally via toEqual
    expect(lazyOut).toEqual(staticOut);
  });

  it("invalid TOML throws (error class not pinned)", async () => {
    const lazy = await loadTomlParser();
    const bad = "this is not = = valid toml\n";
    expect(() => lazy.parse(bad)).toThrow();
    expect(() => tomlStaticParser.parse(bad)).toThrow();
  });

  it("loadTomlParser caches the parser instance across calls", async () => {
    const a = await loadTomlParser();
    const b = await loadTomlParser();
    expect(a).toBe(b);
  });

  it("lazy and static produce equivalent output for multiple inputs", async () => {
    const lazy = await loadTomlParser();
    const inputs = [
      `name = "confetti"\nversion = 1\n`,
      `[a.b.c]\nx = "deep"\n`,
      `flags = ["a", "b", "c"]\n`,
    ];
    for (const raw of inputs) {
      expect(lazy.parse(raw)).toEqual(tomlStaticParser.parse(raw));
    }
  });
});
