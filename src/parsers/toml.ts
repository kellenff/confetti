import type { Parser } from "../types.js";

/**
 * Cached parser instance — populated on first call to
 * {@link loadTomlParser}, returned directly thereafter.
 */
let cachedParser: Parser | undefined;

/**
 * Async loader for the lazy TOML parser. Imports `smol-toml` dynamically
 * on first call; returns a synchronous {@link Parser} thereafter (cached).
 *
 * Use this in environments where dynamic `import()` is allowed (Node.js,
 * Deno, Bun, modern bundlers). For CSP-strict / no-dynamic-import
 * environments (Cloudflare Workers, strict-CSP browsers), use
 * `tomlStaticParser` from `./toml-static.js` instead.
 *
 * Parser errors propagate unchanged; `fileSource` owns `ParseError`
 * wrapping with source-path context.
 */
export async function loadTomlParser(): Promise<Parser> {
  if (cachedParser) return cachedParser;
  const tomlMod = await import("smol-toml");
  cachedParser = {
    extensions: ["toml"],
    parse: (raw: string): unknown => tomlMod.parse(raw),
  };
  return cachedParser;
}
