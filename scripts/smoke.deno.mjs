/* eslint-disable no-console -- console output IS the contract for this CI smoke script */
// Deno-specific smoke test — mirrors scripts/smoke.mjs but uses the
// `npm:` specifier so Deno fetches zod from npm without a node_modules
// directory. Deno also exposes `Deno.exit` rather than `process.exit`.
//
// We import confetti from the built `./dist` artifact (same as the Node /
// Bun smoke), produced by the build job and downloaded via
// actions/download-artifact in CI.
//
// Required Deno permissions: --allow-read --allow-env --allow-sys
// (read for dist files; env + sys are zod / runtime-detect surface area).

import { z } from "npm:zod@^3.25";
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
  Deno.exit(1);
}
if (config.current.host !== "localhost") {
  console.error(`FAIL: expected host=localhost, got ${config.current.host}`);
  Deno.exit(1);
}

console.log("smoke OK");
