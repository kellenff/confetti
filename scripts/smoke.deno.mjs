/* oxlint-disable no-console -- console output IS the contract for this CI smoke script */
// Deno-specific smoke test — mirrors scripts/smoke.mjs but uses the
// `npm:` specifier (Deno fetches zod from npm without a node_modules
// directory) and Deno's env / exit APIs.
//
// We import confetti from the built `./dist` artifact (same as the Node /
// Bun smoke), produced by the build job and downloaded via
// actions/download-artifact in CI. node:fs/promises and node:os/node:path
// are available in Deno via its node compat layer.
//
// Required Deno permissions: --allow-read --allow-write --allow-env
// --allow-sys (read+write for the temp config fixture; env+sys for
// zod / runtime-detect surface area).

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "npm:zod@^3.25.76";
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

Deno.env.set("SMOKE_FOO", "from-env");

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
    Deno.exit(1);
  }
  if (c.host !== "localhost") {
    console.error(`FAIL host: ${c.host}`);
    Deno.exit(1);
  }
  if (c.db.host !== "db.example.com") {
    console.error(`FAIL db.host: ${c.db.host}`);
    Deno.exit(1);
  }
  if (c.foo !== "from-env") {
    console.error(`FAIL foo: ${c.foo}`);
    Deno.exit(1);
  }

  console.log("smoke OK");
} finally {
  await rm(dir, { recursive: true, force: true });
}
