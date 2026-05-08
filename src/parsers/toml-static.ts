import { parse } from "smol-toml";
import type { Parser } from "../types.js";

/**
 * Statically-bound TOML parser. Use when dynamic imports aren't allowed
 * (CSP-strict environments, Cloudflare Workers). Pulls `smol-toml` into
 * the bundle unconditionally — prefer {@link loadTomlParser} from
 * `./toml.js` if you want lazy loading.
 *
 * Parser errors propagate unchanged; `fileSource` owns `ParseError`
 * wrapping with source-path context.
 */
export const tomlStaticParser: Parser = {
  extensions: ["toml"],
  parse: (raw: string): unknown => parse(raw),
};
