/* eslint-disable no-console -- console output IS the contract for this CI smoke script */
// Cross-runtime smoke test for confetti.
//
// Purpose: prove the *built* package (./dist) imports and runs unmodified
// under Node and Bun. Node already runs the full vitest suite in CI; this
// script is what the Bun matrix job invokes to demonstrate that the same
// source compiles + executes there. (For Deno, see scripts/smoke.deno.mjs —
// Deno requires the `npm:` specifier for zod.)
//
// Keep this script *minimal*: a tiny schema, a defaultsSource and an
// overrideSource, and asserts on the merged result. The goal is "did
// the public surface load at all under this runtime", not "are all
// features correct" — vitest covers that on Node.

import { z } from "zod";
import {
  defineConfig,
  defaultsSource,
  overrideSource,
} from "../dist/index.js";

const schema = z.object({
  port: z.number(),
  host: z.string(),
});

const config = await defineConfig({
  schema,
  sources: [
    defaultsSource({ port: 3000, host: "localhost" }),
    overrideSource({ port: 8080 }),
  ],
});

if (config.current.port !== 8080) {
  console.error(`FAIL: expected port=8080, got ${config.current.port}`);
  process.exit(1);
}
if (config.current.host !== "localhost") {
  console.error(`FAIL: expected host=localhost, got ${config.current.host}`);
  process.exit(1);
}

console.log("smoke OK");
