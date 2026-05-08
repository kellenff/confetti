import type { Parser } from "../types.js";

/**
 * Built-in JSON {@link Parser} (handles `.json`).
 *
 * Available unconditionally — JSON has zero peer-dependency cost so it
 * is registered by default. Throws `SyntaxError` on malformed JSON;
 * `fileSource` wraps any parser error in {@link ParseError} with
 * source-path context.
 */
export const jsonParser: Parser = {
  extensions: ["json"],
  parse(raw: string): unknown {
    return JSON.parse(raw);
  },
};
