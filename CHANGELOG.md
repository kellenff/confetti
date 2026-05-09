# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-08

### Added

#### Core

- `defineConfig({ schema, sources })` — Zod-driven config orchestrator. Walks the schema once, loads sources in parallel, deep-merges by priority, validates, and freezes the result. Returns a `Config<T>` whose `current` is typed as `z.output<typeof schema>` exactly.
- Recursive `Object.freeze` on the resolved config; class instances supplied via `overrideSource` (Date, Map, user classes) are preserved as-is.
- `StandardPriority` constants: `default` (0), `file` (25), `env` (50), `flag` (75), `override` (100). Caller-supplied source order is irrelevant — priority decides.

#### Sources

- `overrideSource(value, options?)` — programmatic + test fixture overrides.
- `defaultsSource(value, options?)` — fallback layer.
- `flagsSource(value, options?)` — pre-parsed CLI flags (bring your own argv parser).
- `fileSource(options)` — reads + parses a file with extension-based format detection, optional `format` override, `optional: true` for missing files, per-source `arrayMerge: 'concat' | 'replace'` policy.
- `envSource(options)` — derives expected env-var names from the schema (`server.port` + `prefix: 'APP_'` + `separator: '__'` → `APP_SERVER__PORT`). Coercion: booleans accept `"true"|"1"|"yes"|"on"` (case-insensitive); numbers via `Number()`; arrays split on commas. `warnOnUnknown` flags typos in development.

#### File parsers

- Built-in JSON via native `JSON.parse` — zero runtime dependencies.
- Opt-in YAML (`yaml`), TOML (`smol-toml`), JSON5 (`json5`) parsers with lazy dynamic import.
- Static-injection variants (`confetti/parsers/yaml-static`, `confetti/parsers/toml-static`) for CSP-restricted environments and bundlers that don't tolerate dynamic imports.
- `Parser` interface for custom format support; `ParserRegistry` with `withInjectedParsers` for explicit wiring.

#### Watch and reload

- File watching via `fileSource({ watch: true })` — debounce (75ms default), parent-directory watching to survive atomic rename (`mv tmp.yaml config.yaml`), symlink resolution at watch start.
- `Config<T>.reload()` — programmatic re-run.
- `Config<T>.onChange((next, diff) => ...)` — sequential dispatch in registration order; handler errors route to `onError(err, 'merged')` without halting the loop.
- `Config<T>.onError((err, source) => ...)` — errors that arrive before the first handler attaches are buffered and replayed.
- `Config<T>.close()` — idempotent teardown of watchers + subscribers.
- `ConfigDiff` — sorted `Array<{ path, before, after }>`. Arrays compared as wholes; type-mismatched paths emit one entry without recursing.
- Reload concurrency: at most one reload runs at a time; one queued reload coalesces with latest-wins semantics.

#### Errors

- `AggregatedConfigError` — collects every Zod issue with per-issue source attribution; pre-formatted `.message` includes `[layer]` tags. `'merged'` for structural failures (missing required keys).
- `ParseError` — file-parser rejection with `sourcePath` and `parserName`.
- `UnsupportedSchemaError` — synchronous failure at `defineConfig` time when the schema uses a construct the walker can't introspect (`.transform()`, `.lazy()`, `.intersection()`, `.record()`, `.brand()`, `.pipe()`).
- Type guards: `isAggregatedConfigError`, `isParseError`, `isUnsupportedSchemaError` — cross-realm safe.

#### Cross-runtime

- Lazy runtime detection: same source compiles and runs on Node ≥20, Deno, and Bun.
- CI matrix runs the built `dist/` artifact on Node 20.x + 22.x (Linux), Node 22.x (macOS), Deno 2.x (Linux), and Bun (Linux). Smoke jobs exercise `defineConfig` + sources end-to-end against real temp files and runtime env.

#### Developer experience

- Full TSDoc on every public symbol.
- `expect-type` compile-time assertions guard the public type contract.
- Type-safe schema-first: the schema drives both runtime validation and the static type of `config.current`.

### Known limitations

- `DefineConfigOptions.parsers` and `DefineConfigOptions.runtime` are accepted on the API surface but currently no-op. Per-source injection (`fileSource({ parsers })`, `envSource({ runtime })`) is the working path. Documented in TSDoc; will be either wired or removed before v1.0.
- File watching supports Linux and macOS in v0.1. Windows is deferred.
- No automatic CLI flag parsing — `flagsSource` takes a pre-parsed object. Bring your own (`yargs`, `commander`, `citty`, etc.).
- Remote config sources (Vault, etcd, AWS Parameter Store, GCP Secret Manager) are out of scope until v0.3.

[Unreleased]: https://github.com/kellenff/confetti/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kellenff/confetti/releases/tag/v0.1.0
