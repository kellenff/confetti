# confetti

Layered TypeScript config with a Zod schema. Same code on Node, Deno, and Bun.

Replace `dotenv` + manual parse + ad-hoc validation with a single `defineConfig` call. Sources are merged in priority order, validated against the schema, and frozen. The result is one fully-typed object whose shape matches `z.output<typeof schema>` exactly.

[![npm](https://img.shields.io/npm/v/confetti.svg)](https://www.npmjs.com/package/confetti) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![Node](https://img.shields.io/badge/node-%E2%89%A520-green.svg)](https://nodejs.org) [![CI](https://img.shields.io/badge/ci-passing-brightgreen.svg)](./.github/workflows/ci.yml)

---

## Before / After

A typical TS service today, before confetti:

```ts
import "dotenv/config";

const port = Number(process.env.PORT ?? 3000);
if (Number.isNaN(port)) throw new Error("PORT must be a number");

const host = process.env.HOST ?? "localhost";
if (typeof host !== "string") throw new Error("HOST must be a string");

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL is required");

// ...repeat per env var, scattered across the codebase
const config = { port, host, dbUrl };
```

The same service with confetti:

```ts
import { z } from "zod";
import { defineConfig, defaultsSource, envSource, fileSource } from "confetti";

const schema = z.object({
  port: z.number(),
  host: z.string(),
  dbUrl: z.string().url(),
});

const config = await defineConfig({
  schema,
  sources: [
    defaultsSource({ port: 3000, host: "localhost" }),
    fileSource({ path: "config.yaml", optional: true }),
    envSource({ schema, prefix: "APP_", separator: "__" }),
  ],
});

config.current.port; // typed as number
```

One source of truth for the config shape. Validation is exhaustive: every issue surfaces in a single `AggregatedConfigError` with the layer that supplied each offending value attached.

---

## Contents

- [Install](#install)
- [Quickstart](#quickstart)
- [How it works](#how-it-works)
- [Sources](#sources)
- [File parsers](#file-parsers)
- [Watch and reload](#watch-and-reload)
- [Errors](#errors)
- [Coming from Viper-Go](#coming-from-viper-go)
- [Compatibility](#compatibility)
- [Roadmap](#roadmap)
- [License](#license)

---

## Install

```bash
npm install confetti zod
```

`zod` is a peer dependency. For YAML, TOML, or JSON5 files, install the matching peer:

```bash
npm install yaml         # YAML support
npm install smol-toml    # TOML support
npm install json5        # JSON5 support
```

These are optional — confetti's core JSON path has zero runtime dependencies.

---

## Quickstart

```ts
import { z } from "zod";
import { defineConfig, defaultsSource, envSource } from "confetti";

const schema = z.object({
  server: z.object({
    port: z.number(),
    host: z.string(),
  }),
  debug: z.boolean(),
});

const config = await defineConfig({
  schema,
  sources: [
    defaultsSource({ server: { port: 3000, host: "0.0.0.0" }, debug: false }),
    envSource({ schema, prefix: "APP_", separator: "__" }),
  ],
});

console.log(config.current.server.port);
```

With `APP_SERVER__PORT=8080` set, `config.current.server.port` is `8080`. With nothing set, it falls back to `3000` from `defaultsSource`. The schema drives both the type and the env-var derivation.

---

## How it works

**Precedence.** Sources are sorted by priority ascending; later layers override earlier ones at the leaf level. Caller-supplied order is irrelevant — the priority field decides.

| Layer      | Priority | Typical use                                |
| ---------- | -------- | ------------------------------------------ |
| `default`  | 0        | Fallback values for keys nothing else sets |
| `file`     | 25       | Config files (YAML, TOML, JSON, JSON5)     |
| `env`      | 50       | Environment variables                      |
| `flag`     | 75       | Parsed CLI flags                           |
| `override` | 100      | Programmatic overrides, test fixtures      |

You can supply custom priorities; the standard values come from `StandardPriority`.

**Schema-first.** The Zod schema is mandatory. confetti walks it once at `defineConfig` time to derive expected env-var names and to fail fast on unsupported constructs (`.transform()`, `.lazy()`, `.intersection()`, `.record()`, `.brand()`, `.pipe()` are refused at build time with a clear `UnsupportedSchemaError`).

**Per-issue source attribution.** When `schema.parse` rejects, every Zod issue is wrapped in a `ConfigIssue` whose `source` field names the layer that supplied the offending value (or `'merged'` for structural failures like missing required keys). One `AggregatedConfigError` carries them all.

**Frozen output.** The result is recursively `Object.freeze`-d. Class instances passed through `overrideSource` (Date, Map, user classes) are left alone — only plain objects and arrays are walked.

**Cross-runtime.** Runtime detection is lazy. Same source compiles and runs on Node, Deno, and Bun. The CI matrix runs the built `dist/` artifact on each runtime on every push.

---

## Sources

Five built-in source factories. Each returns a `Source`. All accept an optional `name` (for diagnostics) and `priority` override.

### `overrideSource(value, options?)`

Highest priority by default. Use for programmatic overrides — CLI `--set` values, test fixtures, runtime-computed values.

```ts
overrideSource({ debug: true });
```

### `defaultsSource(value, options?)`

Lowest priority. The fallback layer for keys nothing else sets.

```ts
defaultsSource({ server: { port: 3000 }, debug: false });
```

### `flagsSource(value, options?)`

For pre-parsed CLI flags. confetti does not parse argv itself — bring `yargs`, `commander`, `citty`, or your own parser.

```ts
flagsSource({ port: 8080 });
```

### `fileSource(options)`

Reads and parses a file. Format is detected by extension; pass `format` to override. Missing files throw unless `optional: true`.

```ts
fileSource({ path: "config.yaml" });
fileSource({ path: "secrets.json", optional: true });
fileSource({ path: "app.config", format: "yaml" });
```

Per-source array merge policy: pass `arrayMerge: 'concat'` if you want this source's arrays appended rather than replacing the lower-priority array.

### `envSource(options)`

Walks the schema to derive expected env-var names. With `prefix: 'APP_'` and `separator: '__'`, schema key `server.port` reads `APP_SERVER__PORT`. Booleans accept `"true"|"1"|"yes"|"on"` (case-insensitive); numbers parse via `Number()`; arrays split on commas.

```ts
envSource({ schema, prefix: "APP_", separator: "__" });
```

In development (`NODE_ENV !== 'production'`), env vars matching the prefix that aren't in the schema produce a `console.warn` to flag typos. Disable with `warnOnUnknown: false`. The warning is suppressed when `prefix` is empty.

---

## File parsers

| Format | Built-in | Peer dependency | Notes                      |
| ------ | -------- | --------------- | -------------------------- |
| JSON   | yes      | —               | Native `JSON.parse`        |
| YAML   | no       | `yaml`          | YAML 1.2                   |
| TOML   | no       | `smol-toml`     | TOML 1.1                   |
| JSON5  | no       | `json5`         | Comments + trailing commas |

For environments that disallow dynamic imports (Cloudflare Workers, restricted CSP, some bundler configs), pass parsers explicitly via the static-injection path. The static parser modules import their peer dep directly, so bundlers resolve everything at build time:

```ts
import { yamlStaticParser } from "confetti/parsers/yaml-static";
import {
  defaultRegistry,
  withInjectedParsers,
} from "confetti/parsers/registry";

const registry = withInjectedParsers(defaultRegistry(), {
  yaml: yamlStaticParser,
});

fileSource({ path: "config.yaml", parsers: registry });
```

Custom parsers conform to the `Parser` interface — one method, one extension list. `tomlStaticParser` is available at the matching path.

---

## Watch and reload

Pass a watch-capable source (`fileSource` is the only built-in that watches in v0.1) and confetti reloads on change. `Config<T>` exposes:

```ts
const config = await defineConfig({
  /* ... */
});

const off = config.onChange((next, diff) => {
  console.log("config changed", diff);
});

config.onError((err, source) => {
  console.error(`error from ${source}:`, err);
});

await config.reload(); // programmatic re-run
await config.close(); // tears down watchers and subscribers
off(); // unsubscribe a single handler
```

**Behaviour:**

- Reloads are debounced (75 ms by default; configurable per source).
- Concurrent notifications coalesce: at most one reload runs at a time, with at most one queued (latest-wins).
- `onChange` handlers run sequentially in registration order. A handler that throws routes its error to `onError(err, 'merged')`; subsequent handlers still run.
- Errors that arrive before any `onError` handler is registered are buffered and replayed when the first handler attaches.
- `current` is a getter — after a successful reload, `config.current` returns the new frozen snapshot. Snapshots passed to `onChange` are stable: a handler always sees the snapshot that triggered its emission, even if a newer reload completes mid-loop.
- The diff is a structured `Array<{ path: string[]; before: unknown; after: unknown }>` sorted lexicographically. Arrays are compared as wholes; type-mismatched paths emit one entry without recursing.
- `close()` is idempotent. After it, `reload()` is a no-op.

File watching survives atomic-rename (`mv tmp.yaml config.yaml`) via parent-directory watching and resolves symlinks at watch start. v0.1 supports Linux and macOS; Windows is deferred.

---

## Errors

`AggregatedConfigError` collects every validation issue into a single throw. Its `.message` is preformatted with per-issue source attribution:

```
Config validation failed (3 issues):
  - server.port [env]: Expected number, received nan
  - server.host [merged]: Required
  - database.password [file]: String must contain at least 8 character(s)
```

The `[env]`, `[file]`, `[merged]` tags identify which layer supplied each offending value. `'merged'` is used for structural failures where no layer wrote the leaf — typically missing required keys.

```ts
import { defineConfig, isAggregatedConfigError, isParseError } from "confetti";

try {
  await defineConfig({
    /* ... */
  });
} catch (err) {
  if (isAggregatedConfigError(err)) {
    for (const issue of err.issues) {
      console.error(
        `${issue.path.join(".")} [${issue.source}]: ${issue.message}`,
      );
    }
  } else if (isParseError(err)) {
    console.error(`failed to parse ${err.sourcePath} as ${err.parserName}`);
  } else {
    throw err;
  }
}
```

Three error types in the public surface:

- `AggregatedConfigError` — schema validation produced one or more issues.
- `ParseError` — a file parser rejected. Carries `sourcePath` and `parserName`.
- `UnsupportedSchemaError` — the schema uses a Zod construct confetti's walker can't introspect. Thrown synchronously at `defineConfig` time, before any I/O.

Each ships with a type guard: `isAggregatedConfigError`, `isParseError`, `isUnsupportedSchemaError`. Prefer them over `instanceof` for cross-realm safety.

---

## Coming from Viper-Go

If you've used [`spf13/viper`](https://github.com/spf13/viper) in Go, the mental model carries over: layered sources, priority resolution, file + env + flag merging. The TypeScript surface is different on purpose.

| Viper (Go)                       | confetti                                |
| -------------------------------- | --------------------------------------- |
| `viper.SetDefault("port", 3000)` | `defaultsSource({ port: 3000 })`        |
| `viper.AutomaticEnv()`           | `envSource({ schema })`                 |
| `viper.SetEnvPrefix("APP")`      | `envSource({ schema, prefix: "APP_" })` |
| `viper.BindEnv("server.port")`   | derived automatically from the schema   |
| `viper.SetConfigFile("config")`  | `fileSource({ path: "config.yaml" })`   |
| `viper.GetString("server.host")` | `config.current.server.host` (typed)    |
| `viper.WatchConfig()`            | `config.onChange((next, diff) => ...)`  |
| `viper.OnConfigChange(fn)`       | same                                    |

**Things that are different on purpose.**

- **No global instance.** Every config goes through `defineConfig`. There is no `confetti.GetString(...)` analogue.
- **No string accessors.** `config.current.server.host` — typed end-to-end. The schema is the API.
- **Schema is mandatory.** No silent type coercion; failures throw an aggregated error with per-layer attribution.
- **No automatic flag binding.** `flagsSource` takes a pre-parsed object. Use whichever flag parser you prefer.
- **No `BindEnv` calls.** Env-var names derive from the schema and the prefix/separator pair.
- **Case is preserved.** Only env-var names fold case (`server.port` → `APP_SERVER__PORT`); object keys are reported verbatim everywhere else.

**Things deliberately deferred.** v0.1 has no automatic Viper-Go-to-confetti migration tool; the table above is the manual translation guide. Remote config stores (`etcd`, `consul`, `vault`) are out of scope until v0.3.

---

## Compatibility

| Runtime            | Versions tested in CI            | File watch |
| ------------------ | -------------------------------- | ---------- |
| Node.js            | 20.x, 22.x (Linux), 22.x (macOS) | yes        |
| Deno               | latest 2.x (Linux)               | yes        |
| Bun                | latest (Linux)                   | yes        |
| Cloudflare Workers | manual (no `fs.watch` support)   | no         |
| Windows            | not in v0.1 matrix               | deferred   |

CI runs the built `dist/` artifact under each runtime on every push. The Deno and Bun smoke jobs exercise `defineConfig` + `defaultsSource` + `fileSource` + `envSource` + `overrideSource` end-to-end against a real temp file and `process.env` / `Deno.env`.

For environments without dynamic imports (Workers, restricted CSP), pass parsers via the static-injection API. For environments without file I/O, omit `fileSource` and supply a `customRuntime` to other sources.

---

## Roadmap

Future work, not in v0.1:

- **v0.2** — [Standard Schema](https://github.com/standard-schema/standard-schema) support so Valibot, ArkType, and Effect/Schema can replace Zod. Source-read error attribution. CLI flag-parser bridges (`yargs`, `commander`, `citty`). Bench harness in CI.
- **v0.3** — Remote config sources (AWS Parameter Store / Secrets Manager, GCP Secret Manager, Vault, etcd, consul). Encrypted-config support. Schema migrations for long-running services. SIGHUP-driven reload helper.
- **Future** — JSON Schema export for editor support. OpenTelemetry spans around `defineConfig` and `reload`. First-class edge-runtime entry points (`confetti/edge`). A `viper-go`-to-`confetti` migrator for mixed-language shops.

Roadmap items are not yet scheduled and not yet shipped. Track progress in the GitHub issues.

---

## License

[MIT](./LICENSE)
