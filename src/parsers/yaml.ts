import type { Parser } from "../types.js";

/**
 * Lazy YAML parser. The first call to `loadYamlParser()` dynamically
 * imports the `yaml` package; subsequent calls return the cached parser
 * instance built around the already-imported module.
 *
 * Use this when dynamic imports are allowed (Node, modern bundlers that
 * preserve `import()`). For CSP-strict environments such as Cloudflare
 * Workers or strict-ESM contexts where dynamic imports are disallowed,
 * import `yamlStaticParser` from `./yaml-static.js` instead.
 */
let cachedParser: Parser | undefined;

export async function loadYamlParser(): Promise<Parser> {
  if (cachedParser) return cachedParser;
  const yamlMod = await import("yaml");
  cachedParser = {
    extensions: ["yaml", "yml"],
    parse: (raw: string): unknown => yamlMod.parse(raw),
  };
  return cachedParser;
}
