# confetti — Execute Handoff

**Session paused:** 2026-05-07, 12 of 19 tasks merged, main at `ab57d37`.
**Plan:** [`.claude/kernel-outlines/outline-plan-2026-05-07-viper-ts.md`](./kernel-outlines/outline-plan-2026-05-07-viper-ts.md)
**Resume strategy:** read `.claude/execute-state.json`, this file, then proceed to Batch 5.

---

## What's on main (post-Batch-4)

```
src/
  types.ts                    ← Source, Parser, Runtime, Unwatch, ReloadHandler, ErrorHandler,
                                ConfigDiff, SourceName, StandardPriority (singular keys)
  errors.ts                   ← AggregatedConfigError, ParseError, type guards
  index.ts                    ← placeholder (task 12 owns public exports)
  env-keys/
    walker.ts                 ← walkSchema(z.ZodTypeAny) → SchemaLeaf[]
    unsupported.ts            ← UnsupportedSchemaError + 25+ refusal reasons
    derive.ts                 ← deriveEnvKeys(leaves, { prefix?, separator? }) → EnvKeyMapping[]
                                  SCREAMING_SNAKE w/ acronym handling, path-preserving (task 6b)
    walker.test.ts            ← 88 tests
    derive.test.ts            ← 27 tests
  runtime/
    detect.ts                 ← getRuntime(override?) lazy + customRuntime escape hatch
    node.ts                   ← parent-dir fs.watch + filename filter + error listener
    deno.ts                   ← inline-declared minimal Deno surface
    bun.ts                    ← mirrors node, separate module for symmetry
    detect.test.ts, node.test.ts ← 7 tests
  parsers/
    json.ts                   ← jsonParser delegating to JSON.parse
    yaml.ts                   ← loadYamlParser(): Promise<Parser> (lazy, cached) (task 10)
    yaml-static.ts            ← yamlStaticParser: Parser (static import; CSP-safe) (task 10)
    toml.ts                   ← loadTomlParser(): Promise<Parser> (lazy, cached) (task 11)
    toml-static.ts            ← tomlStaticParser: Parser (static import; CSP-safe) (task 11)
    registry.ts               ← ParserRegistry, defaultRegistry, registerParser,
                                  withInjectedParsers, getParser (format-aware install hints)
    registry.test.ts          ← 12 tests
    yaml.test.ts              ← 8 tests
    toml.test.ts              ← 7 tests
  merge.ts                    ← deepMerge(layers) with array policy + pollution guard
  merge.test.ts               ← 52 tests
  sources/
    override.ts               ← overrideSource(value, options?) priority=100 (task 7)
    defaults.ts               ← defaultsSource(value, options?) priority=0 (task 7)
    flags.ts                  ← flagsSource(value, options?) priority=75 (task 7)
    file.ts                   ← fileSource(options) — extension-detect, ParseError-wraps,
                                  optional + ENOENT, custom runtime/registry (task 9)
    sources.test.ts           ← 21 tests
    file.test.ts              ← 16 tests
  watcher/
    index.ts                  ← watchFile(path, handler, options?) — debounce + symlink resolve
                                  + onError forwarding + idempotent unwatch (task 14a)
    index.test.ts             ← 9 tests (1 known cold-run timing flake; see below)
```

**Test count:** 247 passing across 11 files (`vitest run` clean).
**Type-check:** `tsc --noEmit` clean on both `tsconfig.json` and `tsconfig.test.json`.
**Lint:** `oxlint` clean (0 warnings, 0 errors, 34 files, 126 rules).

**Dependencies added in Batch 4 prep:** `yaml@^2.8.4` and `smol-toml@^1.6.1` as devDeps (commit `7a13040`).

---

## Workflow that's working (unchanged)

For each task:

1. **Spawn babyclaude** with `isolation: "worktree"` — creates worktree at `.claude/worktrees/agent-XXX/` on `worktree-agent-XXX`.
2. **Babyclaude implements** → commits → returns JSON output.
3. **Spawn spec-reviewer** (sonnet) — verifies acceptance criteria. JSON to `.claude/reviews/spec/N.json`.
4. **If spec PASS, spawn code-reviewer** (opus) — quality dimensions w/ confidence scoring. JSON to `.claude/reviews/code/N.json`.
5. **If code review surfaces important issues** — orchestrator (you) edits worktree files inline, commits a `fix(...)` commit on the same branch.
6. **`git merge --no-ff` from main** — runs cleanly through normal Bash now (hook patched).

---

## Critical gotchas (UPDATED)

### 1. ~~merge-gate hook is broken~~ — FIXED ✓

The `~/.claude/plugins/cache/claudikins-marketplace/claudikins-kernel/1.2.0/hooks/merge-gate.sh` script was patched in this session. Two `grep -oP` calls converted to BSD-compatible `sed -nE` (commits stayed on the plugin cache directly — re-apply on plugin update).

Patched logic (line 29 & 38 of the hook):

```sh
MERGE_BRANCH=$(echo "$COMMAND" | sed -nE 's/.*git[[:space:]]+merge[[:space:]]+([^[:space:];|&]+).*/\1/p' | head -1)
TASK_ID=$(echo "$MERGE_BRANCH" | sed -nE 's/.*task-([^-]+).*/\1/p')
```

All Batch 4 merges ran through Bash without `!` workarounds.

### 2. Don't `npm install` while a worktree is running

(Unchanged from prior handoff.) Install peer deps in main + commit BEFORE spawning agents that need them. This is how `yaml`/`smol-toml` were prepped for tasks 10/11.

### 3. Worktree base diverges from main as main moves forward

(Unchanged.) Use `git merge --no-ff` consistently.

### 4. State + reviews + worktree locations

- **Plan:** `.claude/kernel-outlines/outline-plan-2026-05-07-viper-ts.md`
- **State:** `.claude/execute-state.json` (now reflects 12/19 merged)
- **Reviews:** `.claude/reviews/spec/N.json` and `.claude/reviews/code/N.json` (12 of each so far)
- **Worktrees:** `.claude/worktrees/agent-XXX/` — Batch 4 left 6 more lingering. Run `git worktree prune` when convenient.

### 5. Watcher test cold-run flake (NEW)

`src/watcher/index.test.ts` has a known ~1-in-8 cold-run flake (single-change test, expected 1, got 0 or 2 depending on timing). Subsequent runs in the same session are stable. Cause: macOS `fs.watch` event-delivery latency vs. 25ms debounce + 50ms settle. Tuning the constants only shifts which test flakes; the right fix is fake-timers in **task 14b**. The current values are documented inline in the test file with a forward-pointer to 14b.

---

## What to do FIRST in the resuming session

1. `cd /Users/kellen/Projects/viper-ts`
2. Read this file
3. Read `.claude/execute-state.json`
4. Verify state with: `git log --oneline --graph -15 && npx tsc --noEmit && npx vitest run 2>&1 | tail`
5. Optionally: `git worktree prune` to clean up Batch 1-4 stale worktrees
6. Begin **Batch 5** — see below

---

## Batch 5 — what's next (2 tasks, parallelizable)

| #   | Task                                                       | Files                               | Notes                                                                                                                                              |
| --- | ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | envSource (uses runtime + env-keys/derive)                 | `src/sources/env.ts`, `env.test.ts` | Walks env via runtime.listEnv(prefix), maps via deriveEnvKeys + EnvKeyMapping. Coerces by leaf.inputType. Dev-mode warns on unknown prefixed keys. |
| 14b | Watcher edge-case fixtures: atomic-rename, symlink, bursts | `src/watcher/test/scenarios/`       | Fake-timer scenarios + atomic-rename integration test. Replace 14a's brittle real-fs timing with deterministic harness where possible.             |

Both depend on already-merged tasks (8 needs 6b + 3; 14b needs 14a). No file collision. Spawn both in parallel.

**Open question for the resumer:** Task 14b should consider whether to also remove the cold-run flake in `src/watcher/index.test.ts` itself — converting to fake timers — or to keep the real-fs smoke test and just add deterministic scenario coverage on top. Recommendation: keep one real-fs smoke test + add deterministic `vi.useFakeTimers()` coverage for the deterministic scenarios.

---

## Batch 6+ summary (downstream)

- **Batch 6** (1): `12` (pipeline orchestrator — integrates 5, 7, 8, 9; the load-bearing task)
- **Batch 7** (3): `13` (errors polish), `15` (reload + diff + onChange/onError), `16` (CI matrix)
- **Batch 8** (1): `17` (TSDoc + expect-type tests)
- **Batch 9** (1): `18` (README)

---

## Review-fix history this session (Batch 4)

- **14a code review CONCERNS** — top-level `node:fs/promises` import broke Workers compat. Fixed inline by deferring to dynamic `await import('node:fs/promises')` inside the resolveSymlinks block (commit `6ad118d` on the worktree branch, included in merge `ab57d37`).
- **14a test timing** — multiple tuning attempts; reverted to agent's original 25ms/50ms with documenting comment + forward-pointer to task 14b (commit `e56710e`).

All other code reviews were PASS with only minor (sub-threshold) issues — DRY suggestions in tasks 7/9, cache-promise vs cache-parser pattern in tasks 10/11. None merge-blocking.

---

## Conversation context tips for the resuming session

- Memory: this user has a private global CLAUDE.md preferring functional TS, Zod, "parse don't validate", oxlint+oxfmt, fastify. Tone is concise; avoid over-explaining familiar tech.
- The plan file in `.claude/kernel-outlines/` is the source of truth for acceptance criteria. Refer to it when writing per-task agent prompts.
- Per-task acceptance criteria need to be DERIVED for the agent prompt — the plan's task table is one row, but each task has implicit criteria from §2 success criteria and §3 architecture.
- For learning-mode tasks (15 was flagged): defer until execute time and ask if user wants to hand-write before spawning. Task 8 + 14b are not learning-mode candidates.
- Use `AskUserQuestion` to gate every batch start, every review-fix decision, and every merge.
