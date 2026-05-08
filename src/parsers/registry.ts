import type { Parser } from "../types.js";
import { jsonParser } from "./json.js";

export type ParserRegistry = ReadonlyMap<string, Parser>;

/** Mutable registry used during construction; freeze to expose as ParserRegistry. */
type MutableRegistry = Map<string, Parser>;

/**
 * Build a fresh registry pre-loaded with the built-in JSON parser.
 * Add more parsers via {@link registerParser} or {@link withInjectedParsers}.
 */
export function defaultRegistry(): MutableRegistry {
  const reg = new Map<string, Parser>();
  registerParser(reg, jsonParser);
  return reg;
}

/**
 * Register a parser in the registry under all its declared extensions.
 * Keys are lowercased; passing a parser whose extensions overlap an
 * existing entry overrides that entry.
 */
export function registerParser(reg: MutableRegistry, parser: Parser): void {
  for (const ext of parser.extensions) {
    reg.set(ext.toLowerCase(), parser);
  }
}

/**
 * Overlay user-supplied parsers on top of a base registry. The injected
 * map is keyed by format name OR extension (e.g. 'yaml' or 'yml').
 * Each injected parser is also registered under its own .extensions.
 *
 * Use this for CSP-strict environments (Cloudflare Workers, browsers
 * with strict CSP) where dynamic import('yaml') is not allowed —
 * users statically import the parser themselves and inject.
 */
export function withInjectedParsers(
  base: ParserRegistry,
  injected: Record<string, Parser>,
): ParserRegistry {
  const merged = new Map(base);
  for (const [key, parser] of Object.entries(injected)) {
    merged.set(key.toLowerCase(), parser);
    for (const ext of parser.extensions) {
      merged.set(ext.toLowerCase(), parser);
    }
  }
  return merged;
}

/**
 * Look up a parser by format name or extension. Throws a clear error
 * if no parser is registered, suggesting peer-dep install or injection.
 */
export function getParser(reg: ParserRegistry, formatOrExt: string): Parser {
  const key = formatOrExt.toLowerCase();
  const p = reg.get(key);
  if (!p) {
    const known = Array.from(new Set(reg.values()))
      .flatMap((parser) => parser.extensions)
      .sort();
    throw new Error(
      `confetti: no parser registered for '${formatOrExt}'. ` +
        `Known formats: ${known.join(", ")}. ` +
        `For YAML/TOML/JSON5, install the peer dep (e.g. \`npm i yaml\`) or pass via defineConfig({ parsers })`,
    );
  }
  return p;
}
