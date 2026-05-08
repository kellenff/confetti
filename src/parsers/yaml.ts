import type { Parser } from "../types.js";

let cachedParser: Parser | undefined;

/**
 * Lazily load a YAML {@link Parser}.
 *
 * The first call dynamically imports the `yaml` peer dependency;
 * subsequent calls return the cached parser instance.
 *
 * Use this when dynamic imports are allowed (Node, Deno, Bun, modern
 * bundlers that preserve `import()`). For CSP-strict environments such
 * as Cloudflare Workers or strict-ESM contexts where dynamic imports
 * are disallowed, import `yamlStaticParser` from `./yaml-static.js`
 * instead.
 *
 * @returns A `Parser` registered for the `yaml` and `yml` extensions.
 */
export async function loadYamlParser(): Promise<Parser> {
  if (cachedParser) return cachedParser;
  const yamlMod = await import("yaml");
  cachedParser = {
    extensions: ["yaml", "yml"],
    parse: (raw: string): unknown => yamlMod.parse(raw),
  };
  return cachedParser;
}
