import type { Parser } from "../types.js";

/**
 * Built-in JSON parser. Throws SyntaxError on malformed JSON;
 * fileSource (task 9) wraps any parser error in ParseError with
 * source-path context.
 */
export const jsonParser: Parser = {
  extensions: ["json"],
  parse(raw: string): unknown {
    return JSON.parse(raw);
  },
};
