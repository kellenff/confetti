import type { Parser } from "../types.js";
import { jsonParser } from "./json.js";

/**
 * Read-only view of a parser registry — keys are format names AND
 * extensions (lowercased), values are the corresponding Parser.
 * Pipeline code accepts this; user-facing APIs return this.
 */
export type ParserRegistry = ReadonlyMap<string, Parser>;

/**
 * Construction-time view: the same registry typed as mutable so
 * `registerParser` can populate it. Returned by {@link defaultRegistry}
 * for the build-then-hand-off pattern. Once handed to the pipeline,
 * treat as `ParserRegistry` (readonly). Mutating after handoff is
 * unspecified behaviour.
 */
export type MutableParserRegistry = Map<string, Parser>;

/**
 * Build a fresh registry pre-loaded with the built-in JSON parser.
 * Returned typed as {@link MutableParserRegistry} so the caller can
 * register more parsers via {@link registerParser}; cast to
 * {@link ParserRegistry} (or pass to {@link withInjectedParsers}) once
 * construction is complete.
 */
export function defaultRegistry(): MutableParserRegistry {
  const reg: MutableParserRegistry = new Map();
  registerParser(reg, jsonParser);
  return reg;
}

/**
 * Register a parser in the registry under all its declared extensions.
 * Keys are lowercased; passing a parser whose extensions overlap an
 * existing entry overrides that entry.
 */
export function registerParser(
  reg: MutableParserRegistry,
  parser: Parser,
): void {
  for (const ext of parser.extensions) {
    reg.set(ext.toLowerCase(), parser);
  }
}

/**
 * Overlay user-supplied parsers on top of a base registry. The injected
 * map is keyed by format name OR extension (e.g. 'yaml' or 'yml').
 * Each injected parser is also registered under its own .extensions.
 *
 * Precedence: iteration order of `Object.entries(injected)` (insertion
 * order for string keys). Each entry's explicit key is set first, then
 * its extensions; later entries override earlier ones at the same key.
 * Within a single entry, the explicit key overlays any conflicting
 * extension already set by an earlier entry.
 *
 * Non-mutating: the base registry is unchanged after the call.
 *
 * Use for CSP-strict environments (Cloudflare Workers, strict-CSP
 * browsers) where dynamic `import('yaml')` is not allowed — users
 * statically import the parser themselves and inject.
 */
export function withInjectedParsers(
  base: ParserRegistry,
  injected: Record<string, Parser>,
): ParserRegistry {
  const merged: MutableParserRegistry = new Map(base);
  for (const [key, parser] of Object.entries(injected)) {
    for (const ext of parser.extensions) {
      merged.set(ext.toLowerCase(), parser);
    }
    // Set the explicit key last so it wins over the parser's own
    // extensions if they differ (e.g. injected under 'yaml' for a
    // parser whose extensions only include 'yml').
    merged.set(key.toLowerCase(), parser);
  }
  return merged;
}

/**
 * Look up a parser by format name or extension. Throws a clear error
 * if no parser is registered, suggesting peer-dep install or injection.
 */
/** Map known optional formats to their npm package names for install hints. */
const PEER_DEPS: Record<string, string> = {
  yaml: "yaml",
  yml: "yaml",
  toml: "smol-toml",
  json5: "json5",
  jsonc: "json5",
};

export function getParser(reg: ParserRegistry, formatOrExt: string): Parser {
  const key = formatOrExt.toLowerCase();
  const p = reg.get(key);
  if (!p) {
    const known = Array.from(new Set(reg.values()))
      .flatMap((parser) => parser.extensions)
      .sort();
    const peerDep = PEER_DEPS[key];
    const installHint = peerDep
      ? `Install the peer dep: \`npm i ${peerDep}\`.`
      : `If this is a known format, install the corresponding peer dep.`;
    throw new Error(
      `confetti: no parser registered for '${formatOrExt}'. ` +
        `Known formats: ${known.join(", ")}. ` +
        `${installHint} ` +
        `For CSP-strict / no-dynamic-import environments, pass via defineConfig({ parsers: { ${formatOrExt}: yourParser } })`,
    );
  }
  return p;
}
