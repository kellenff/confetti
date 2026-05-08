/* oxlint-disable no-console -- console output IS the contract for this CI smoke script */
// Cross-runtime smoke test for confetti (Node + Bun variant).
//
// Purpose: prove the *built* package (./dist) imports and runs unmodified
// under Node and Bun. Node already runs the full vitest suite in CI; this
// script is what the Bun matrix job invokes to demonstrate that the same
// source compiles + executes there. (For Deno, see scripts/smoke.deno.mjs —
// Deno needs `npm:` zod and `Deno.env.set` instead of `process.env`.)
//
// Coverage exercises four sources so the smoke catches cross-runtime
// regressions in fileSource (fs adapter) and envSource (env adapter),
// not just in-memory merge:
//   - defaultsSource:  port=3000, host=localhost
//   - fileSource:      writes a temp JSON with db.host
//   - envSource:       reads SMOKE_FOO via the schema-derived key
//   - overrideSource:  port=8080
// Final assertions exercise precedence at each layer.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  defineConfig,
  defaultsSource,
  envSource,
  fileSource,
  overrideSource,
} from "../dist/index.js";

const schema = z.object({
  port: z.number(),
  host: z.string(),
  db: z.object({ host: z.string() }),
  foo: z.string(),
});

process.env.SMOKE_FOO = "from-env";

const dir = await mkdtemp(join(tmpdir(), "confetti-smoke-"));
const cfgPath = join(dir, "config.json");
await writeFile(cfgPath, JSON.stringify({ db: { host: "db.example.com" } }));

try {
  const config = await defineConfig({
    schema,
    sources: [
      defaultsSource({ port: 3000, host: "localhost" }),
      fileSource({ path: cfgPath }),
      envSource({ schema, prefix: "SMOKE_", separator: "__" }),
      overrideSource({ port: 8080 }),
    ],
  });

  const c = config.current;
  if (c.port !== 8080) {
    console.error(`FAIL port: ${c.port}`);
    process.exit(1);
  }
  if (c.host !== "localhost") {
    console.error(`FAIL host: ${c.host}`);
    process.exit(1);
  }
  if (c.db.host !== "db.example.com") {
    console.error(`FAIL db.host: ${c.db.host}`);
    process.exit(1);
  }
  if (c.foo !== "from-env") {
    console.error(`FAIL foo: ${c.foo}`);
    process.exit(1);
  }

  console.log("smoke OK");
} finally {
  await rm(dir, { recursive: true, force: true });
}
