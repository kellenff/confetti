import { parse } from "yaml";
import type { Parser } from "../types.js";

/**
 * Statically-bound YAML parser. Use when dynamic imports are not allowed
 * (CSP-strict environments, Cloudflare Workers, strict ESM). Imports the
 * `yaml` peer dependency directly so bundlers resolve it at build time.
 *
 * Consumers opt in explicitly:
 *   defineConfig({ parsers: { yaml: yamlStaticParser } })
 */
export const yamlStaticParser: Parser = {
  extensions: ["yaml", "yml"],
  parse: (raw: string): unknown => parse(raw),
};
