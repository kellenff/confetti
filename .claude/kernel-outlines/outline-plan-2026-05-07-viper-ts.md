# confetti — Plan

**Session:** plan-2026-05-07-viper-ts (project repo retains the `viper-ts` directory name; npm package will publish as `confetti`)
**Date:** 2026-05-07
**Approach:** A — Schema-as-Pipeline (Zod-first, single entry point)
**Output package:** `confetti` (single npm package, all-in-one)
**Inspired by, not affiliated with:** [spf13/viper](https://github.com/spf13/viper) (Go). API is intentionally different.

---

## 1. Problem Statement & Scope

### Problem

TypeScript's config-library ecosystem is fragmented. Layered loaders (`c12`, `node-config`) lack schema-first parsing; schema-first env parsers (`znv`, `t3-env`) lack file/flag layering; nothing is runtime-agnostic across Node + Deno + Bun. Go's Viper solved layered config but locked itself into footguns (lowercased keys, global singletons, AutomaticEnv-vs-BindEnv duality, hardcoded parsers, silent type coercion). We will build a TS package that takes Viper's good ideas (precedence chain, multi-format, file watching) and combines them with TS-native solutions to its known problems (Zod schema as the known-keys registry, eager merge + frozen result, case-preserving keys, lazy-loaded parsers).

### In Scope

1. Core orchestrator: `defineConfig({ schema, sources, defaults })` returning a frozen typed object
2. Source adapters: `fileSource`, `envSource`, `flagsSource`, `overrideSource`, `defaultsSource`
3. Format parsers, lazy-loaded: JSON (built-in), YAML, TOML
4. Runtime adapters for fs + env + watch: Node, Deno, Bun (single package, runtime-detected)
5. File watching (parent-dir watch + symlink resolve, debounced) with typed `onChange(next, diff)` API
6. Schema-driven env key derivation (Zod walk → list of expected env vars)
7. Configurable merge strategies (deep merge default; per-source array policy: `replace` | `concat`)
8. Aggregated parse + validation errors

### Out of Scope

- Remote config stores (etcd, consul, firestore, vault)
- Encrypted configs (dotenvx-style)
- CLI flag _parsing_ (we accept a parsed flags object)
- 1:1 Viper API parity (no `GetString`, no `BindEnv`, no global singleton)
- Migration tooling from Viper-Go to confetti
- Windows file-watching support in v0.1 (deferred)

### Explicit Anti-Goals

- We do **not** export a stringly-typed `get(path)` API. Schema is mandatory.
- We do **not** silently coerce types. Schema parse failures throw aggregated errors.
- We do **not** ship a default global instance. Every config is created via `defineConfig`.
- We do **not** lowercase keys. Case is preserved; only env-var name mapping folds case.

---

## 2. Success Criteria

### Functional

1. `defineConfig` returns a frozen object whose return type is `z.output<typeof schema>`. Verified by `expect-type` compile-time tests asserting `expectTypeOf(config).toEqualTypeOf<z.output<typeof schema>>()` on at least 5 representative schemas (primitives, nested objects, optional fields, defaults, transforms).
2. Precedence is verifiable: a fixture with the same key set in all 5 layers (override > flags > env > file > defaults) returns the override value, and removing layers walks down the chain in the documented order. Test asserts the exact value at each step.
3. Schema parse failure produces an `AggregatedConfigError` whose `.issues` field contains one entry per Zod issue path. Aggregation depth: leaf-level for present-but-invalid fields, parent-level for absent required fields (matching Zod's default issue emission). Each issue carries `source: 'override' | 'flag' | 'env' | 'file' | 'default' | 'merged'` identifying which layer provided the offending value (or 'merged' when the failure is structural).
4. Env source derives expected env vars from the schema (e.g. `server.port` + prefix `APP_` + separator `__` → reads `APP_SERVER__PORT`). Keys not in the schema are ignored silently in production builds; in development/test (when `process.env.NODE_ENV !== 'production'`) a `console.warn` lists unknown env vars matching the prefix to aid typo detection.
5. File source detects format by extension; explicit `format` option overrides; unknown extensions throw a clear error naming the unknown extension and listing supported ones.
6. Watch mode emits `onChange(next, diff)` after a debounce window (default 75ms, configurable via `watchDebounceMs`). Subscribers are invoked **sequentially in registration order**; thrown errors are caught and re-emitted to a separate `onError(err, source)` channel without halting other subscribers. The `next` argument is the snapshot that triggered the emission, even if a newer reload has since completed (subscribers may call `config.current()` to fetch the latest). `diff` is a structured `Array<{ path: string[]; before: unknown; after: unknown }>`. `unwatch()` cleanly tears down listeners (`reload()` after `unwatch()` is a no-op).
7. Atomic-rename file replacement (`mv tmp.yaml config.yaml`) is detected (parent-dir watch + symlink resolve). Verified by integration test fixture.
8. Same code runs unmodified on Node ≥20, Deno ≥1.40, and Bun ≥1.0. CI proves this with the same test suite invoked under each runtime.

### Non-functional

9. Zero runtime deps for core JSON path; YAML/TOML/JSON5 are optional peer deps OR injectable via `parsers: { yaml: yamlParse }` in `defineConfig` for environments that disallow dynamic imports (CSP, Cloudflare Workers).
10. Cold-start config load (1KB YAML + 10 env vars + schema parse) completes in <10ms on GitHub Actions `ubuntu-latest` (median of 50 runs, warm Node process — cold V8 not measured). Benchmark harness lives in `bench/cold-start.ts` and runs in CI.
11. Public API documented with TSDoc; `expect-type` tests assert exported types.
12. Test coverage ≥85% lines on core (`src/`, excluding `src/runtime/{deno,bun}.ts` which are exercised in cross-runtime CI rather than unit tests); every source adapter has unit + contract tests.

### Anti-Criteria (rejected as success)

- Backwards-compatible API with Viper-Go
- Silent type coercion
- Lowercased keys
- Global default instance

---

## 3. Architecture

### Pipeline

```
schema (Zod)
   │
   ▼
derive env-keys ──▶ load sources (in parallel) ──▶ merge (by priority, deep, with array policy)
                                                            │
                                                            ▼
                                                  schema.parse(merged)
                                                  → AggregatedConfigError on failure
                                                            │
                                                            ▼
                                                  Object.freeze(typed)
                                                            │
                                                            ▼
                                                  return Config<T>
```

Watch mode reruns the pipeline on file change → diffs old vs new → emits `onChange(next, diff)`.

### Module Layout (single package: `confetti`)

```
src/
  index.ts                  ← public API: defineConfig, source factories, types
  pipeline.ts               ← derive → load → merge → parse → freeze
  merge.ts                  ← deep-merge with array policy
  diff.ts                   ← old/new → structured path diff
  env-keys.ts               ← Zod schema walk → expected env paths
  errors.ts                 ← AggregatedConfigError
  types.ts                  ← Source, Parser, Runtime interfaces
  sources/
    file.ts                 ← fileSource()
    env.ts                  ← envSource()
    flags.ts                ← flagsSource()
    override.ts             ← overrideSource()
    defaults.ts             ← defaultsSource()
  parsers/
    registry.ts             ← name → parser lookup
    json.ts                 ← always available
    yaml.ts                 ← lazy import('yaml')
    toml.ts                 ← lazy import('smol-toml')
  runtime/
    detect.ts               ← picks node|deno|bun at module load
    node.ts
    deno.ts
    bun.ts
  watcher/
    index.ts                ← parent-dir watch + symlink + debounce
```

### Key Contracts

```typescript
interface Source {
  name: string; // for diagnostics
  priority: number; // 0=defaults … 100=override
  read(): Promise<unknown>;
  watch?(handler: ReloadHandler): Unwatch;
  arrayMerge?: "replace" | "concat";
}

interface Parser {
  extensions: string[];
  parse(raw: string): unknown;
}

interface Runtime {
  readFile(path: string): Promise<string>;
  readEnv(key: string): string | undefined;
  listEnv(prefix: string): Record<string, string>;
  watchPath?(path: string, handler: () => void): Unwatch;
}
```

### Runtime Resolution (lazy, with escape hatch)

Runtime is resolved on first use, NOT at module load. This is critical for Cloudflare Workers and other edge runtimes where a top-level `import 'node:fs'` throws before any detection code can run.

```typescript
// runtime/detect.ts
let cached: Runtime | undefined;

export async function getRuntime(override?: Runtime): Promise<Runtime> {
  if (override) return override;
  if (cached) return cached;
  if (typeof Deno !== "undefined") {
    cached = (await import("./deno.js")).denoRuntime;
  } else if (typeof Bun !== "undefined") {
    cached = (await import("./bun.js")).bunRuntime;
  } else {
    cached = (await import("./node.js")).nodeRuntime;
  }
  return cached;
}
```

`defineConfig` accepts a `runtime?: Runtime` option for fully custom hosts (Workers, embedded JS, test environments). When supplied, it bypasses detection entirely.

### Parser Injection (CSP-safe path)

Parsers are normally lazy-imported (`await import('yaml')`) but `defineConfig` also accepts a `parsers?: Record<string, Parser>` map that overrides the registry. This is the portable path for strict-CSP browsers, Cloudflare Workers, and bundlers that bail on dynamic imports.

```typescript
import yamlParser from "confetti/parsers/yaml-static"; // wraps user-installed yaml
defineConfig({
  schema,
  parsers: { yaml: yamlParser },
  sources: [fileSource({ path: "app.yaml" })],
});
```

### Standard Source Priorities

| Layer        | Priority |
| ------------ | -------- |
| defaults     | 0        |
| file         | 25       |
| env          | 50       |
| flags        | 75       |
| override/set | 100      |

Users can supply custom values; ties resolved by declaration order.

---

## 4. Tasks

<!-- EXECUTION_TASKS_START -->

| #   | Task                                                                           | Files                                                         | Deps    | Batch |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------- | ----- |
| 1   | Init repo: package.json, tsconfig, oxlint, vitest, src/ layout                 | package.json, tsconfig.json, .oxlintrc.json, vitest.config.ts | -       | 1     |
| 2   | Define core types (Source, Parser, Runtime) + error class                      | src/types.ts, src/errors.ts                                   | 1       | 2     |
| 3   | Runtime adapters: lazy detect + Node + Deno + Bun + customRuntime escape hatch | src/runtime/detect.ts, src/runtime/node.ts, deno.ts, bun.ts   | 2       | 3     |
| 4   | JSON parser (built-in) + parser registry + injection API                       | src/parsers/json.ts, src/parsers/registry.ts                  | 2       | 3     |
| 5   | Deep-merge with array policy                                                   | src/merge.ts, src/merge.test.ts                               | 2       | 3     |
| 6a  | Zod walker: scope + unsupported-schema detection                               | src/env-keys/walker.ts, src/env-keys/unsupported.ts           | 2       | 3     |
| 6b  | Env-key derivation from walker output (input-side mapping)                     | src/env-keys/derive.ts, src/env-keys/derive.test.ts           | 6a      | 4     |
| 7   | overrideSource, defaultsSource, flagsSource                                    | src/sources/override.ts, defaults.ts, flags.ts                | 2,5     | 4     |
| 8   | envSource (uses runtime + env-keys)                                            | src/sources/env.ts, src/sources/env.test.ts                   | 3,6b    | 5     |
| 9   | fileSource (uses runtime + parser registry)                                    | src/sources/file.ts, src/sources/file.test.ts                 | 3,4     | 4     |
| 10  | YAML parser (lazy peer dep + static-injection wrapper)                         | src/parsers/yaml.ts, src/parsers/yaml-static.ts               | 4       | 4     |
| 11  | TOML parser (lazy peer dep + static-injection wrapper)                         | src/parsers/toml.ts, src/parsers/toml-static.ts               | 4       | 4     |
| 12  | Pipeline orchestrator (defineConfig) — happy path                              | src/pipeline.ts, src/index.ts                                 | 5,7,8,9 | 6     |
| 13  | Aggregated parse errors (per-issue source attribution)                         | src/errors.ts (extend), src/errors.test.ts                    | 12      | 7     |
| 14a | Watcher core: parent-dir watch + symlink + debounce                            | src/watcher/index.ts                                          | 3       | 4     |
| 14b | Watcher edge cases: atomic-rename, symlink-chain, editor burst                 | src/watcher/test/scenarios/                                   | 14a     | 5     |
| 15  | Reload pipeline + diff + onChange + onError sequencing                         | src/pipeline.ts (extend), src/diff.ts, src/subscribers.ts     | 12,14a  | 7     |
| 16  | Cross-runtime CI matrix (Node 20+22, Deno, Bun)                                | .github/workflows/ci.yml                                      | 12      | 7     |
| 17  | Public API docs (TSDoc) + expect-type tests                                    | src/\*_/_.ts (TSDoc), test/types.test-d.ts                    | 12      | 8     |
| 18  | README with quickstart + migration-from-Viper-Go notes                         | README.md                                                     | 12,15   | 9     |

<!-- EXECUTION_TASKS_END -->

### Parallelism Map

- **Batch 1:** 1
- **Batch 2:** 2
- **Batch 3:** 3, 4, 5, 6a (parallel) — note 6a is a long-pole; start it here alongside scaffolding
- **Batch 4:** 6b, 7, 9, 10, 11, 14a (parallel)
- **Batch 5:** 8, 14b (parallel) — 8 needs 6b; 14b needs 14a
- **Batch 6:** 12 (integrates 5+7+8+9)
- **Batch 7:** 13, 15, 16 (parallel)
- **Batch 8:** 17
- **Batch 9:** 18

**Long-pole tasks** (each ~2-3× sibling effort; do not assume parity):

- **Task 6a** — Zod walker scope. Must explicitly enumerate which schema constructs we support (`ZodObject`, `ZodString`, `ZodNumber`, `ZodBoolean`, `ZodArray`, `ZodOptional`, `ZodDefault`, `ZodEnum`, `ZodLiteral`, `ZodUnion` of literals only) and which we **refuse at `defineConfig` time** with a clear error (`ZodEffects`/`.transform()`, `ZodLazy`, `ZodIntersection`, `ZodRecord`, `ZodCatch`, `.pipe()`, `.brand()` — initially). For `.transform()`, the walker operates on `z.input<T>`, so env vars map to the _input_ type; this is documented as a known limitation users opt out of by avoiding transforms in env-bound paths.
- **Task 14a/14b** — Cross-runtime watcher. Three runtimes × three watch APIs (`fs.watch`, `Deno.watchFs`, Bun's `node:fs.watch`) × editor-burst handling × symlink-chain resolution. Each environment needs its own integration fixture.

### Learning-Mode Candidates

These tasks have multiple valid implementations and material UX consequences. User may opt to write them at execute time:

- **Task 5** — deep-merge with array policy (~30-50 lines): array `replace` vs `concat`, undefined-vs-null semantics, prototype pollution guard. Good fit for hand-write.
- **Task 15** — reload diff (~30-40 lines): structural-equality vs reference-equality; how to represent array changes; per-path or aggregated. Good fit for hand-write.

> **Removed from learning-mode:** Task 6a/6b (Zod walker). Klaus's review surfaced that Zod internals are unstable and the walker is realistically 200-400 lines with a substantial test matrix. Too risky to scope-shift mid-execution; this should be implemented with full agent context and a contract-test gate.

---

## 5. Dependencies & Risks

### External Dependencies (peer, optional)

| Package     | Purpose         | Why                                                           |
| ----------- | --------------- | ------------------------------------------------------------- |
| `zod`       | User schema lib | Most popular; Standard Schema added later for Valibot/ArkType |
| `yaml`      | YAML parsing    | Active, ESM, richer than js-yaml                              |
| `smol-toml` | TOML parsing    | TOML 1.1, 2-18× faster than alternatives, pure TS             |
| `json5`     | JSON5/JSONC     | Optional; ~65M wk; ships own types                            |

Core JSON path: zero required runtime deps.

### Risks & Mitigations

| #   | Risk                                                                                  | Likelihood | Impact | Mitigation                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Watcher fires duplicate events on editor saves                                        | High       | Medium | Debounce 75ms (configurable); parent-dir watch + symlink resolve                                                                                                                                                       |
| R2  | Lazy `import('yaml')` fails in CSP/Workers/some bundlers                              | High       | High   | Ship parser-injection API as the portable path; lazy import is convenience-only. Test with esbuild + Vite + Next + Cloudflare Workers + tsc. Clear error if neither route is available.                                |
| R3  | Deno `node:fs/promises.watch` compat doesn't fire on all events                       | Medium     | High   | Use `Deno.watchFs` directly in deno adapter; CI integration test                                                                                                                                                       |
| R4  | Zod internals (`_def`) are explicitly not a public API; walker breaks across versions | High       | High   | Walker has a finite supported-schema set, refuses unsupported nodes at `defineConfig` time with clear errors. Snapshot test pins observed `_def` shapes per Zod version. Rebuild walker for Zod v4 as a discrete task. |
| R5  | Standard Schema needs different walkers per lib                                       | Low        | Medium | Defer to v0.2; ship v0.1 Zod-only                                                                                                                                                                                      |
| R6  | Pretty error formatting bloats core                                                   | Low        | Low    | Keep core error class minimal; separate `formatError()` helper                                                                                                                                                         |
| R7  | Concurrent reload + read race                                                         | Medium     | Medium | `reload()` returns new frozen object; users hold references                                                                                                                                                            |
| R8  | TOML/YAML upstream parser-error UX is poor                                            | Medium     | Low    | Wrap upstream errors; include source path + parser-name                                                                                                                                                                |
| R9  | Symlink eval differs across runtimes                                                  | Low        | Medium | Runtime adapter abstracts; CI tests with symlinked fixtures                                                                                                                                                            |
| R10 | Bun `node:fs.watch` semantics drift from Node                                         | Medium     | Medium | Watcher integration tests on Bun specifically; document deltas                                                                                                                                                         |

### Risks Accepted

- No Windows support in v0.1
- No config-schema migration tooling

---

## 6. Verification Checklist

### Per-Task / Per-PR

- [ ] All new code has unit tests; coverage delta non-negative
- [ ] Public exports have TSDoc
- [ ] `oxlint` clean
- [ ] `tsc --noEmit` clean
- [ ] `vitest run` green on Node 20 + 22

### Pre-Tag (before each release)

- [ ] CI matrix green: Node 20, Node 22, Deno latest, Bun latest
- [ ] Bundle size budget: core <15KB min; with all parsers <80KB min
- [ ] Cold-start benchmark <10ms (1KB YAML + 10 env)
- [ ] `tsd` type-tests pass; no `any` leaks
- [ ] Watcher integration tests pass on Linux + macOS (Windows deferred)
- [ ] Watcher survives: atomic-rename, symlink swap, editor save burst

### Manual Smoke (boot a tiny app)

1. Fastify app reading `config.yaml` + `APP_*` env + flags
2. Verify precedence by changing a value at each layer
3. Verify reload: edit file → confirm `onChange` fires once with correct diff
4. Verify error UX: missing required field → message names every missing key with source layer
5. Repeat under Deno (`deno run`) and Bun (`bun run`)

### Migration Verification

- [ ] README has a "Coming from Viper-Go" section
- [ ] Anti-patterns documented: why no `GetString`, why no global, why schema is required

---

## 7. Next Steps

After approval:

- `claudikins-kernel:execute .claude/kernel-outlines/outline-plan-2026-05-07-viper-ts.md`
- Tasks 1-2 are sequential; tasks 3-6 fan out in parallel; everything converges at task 12.
- At execute time, flag whether you want to hand-write tasks 5 or 15 (learning-mode opt-in). Task 6 (Zod walker) was removed from the learning-mode list after review.
