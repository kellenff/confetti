# confetti — Execute Handoff

**Session paused:** 2026-05-07, 6 of 19 tasks merged, main at `2676ace`.
**Plan:** [`.claude/kernel-outlines/outline-plan-2026-05-07-viper-ts.md`](./kernel-outlines/outline-plan-2026-05-07-viper-ts.md)
**Resume strategy:** read `.claude/execute-state.json`, this file, then proceed to Batch 4.

---

## What's on main

```
src/
  types.ts              ← Source, Parser, Runtime, Unwatch, ReloadHandler, ErrorHandler,
                          ConfigDiff, SourceName, StandardPriority (singular keys)
  errors.ts             ← AggregatedConfigError, ParseError, type guards
  index.ts              ← placeholder (task 12 owns public exports)
  env-keys/
    walker.ts           ← walkSchema(z.ZodTypeAny) → SchemaLeaf[]
    unsupported.ts      ← UnsupportedSchemaError + 25+ refusal reasons
    walker.test.ts      ← 88 tests
  runtime/
    detect.ts           ← getRuntime(override?) lazy + customRuntime escape hatch
    node.ts             ← parent-dir fs.watch + filename filter + error listener
    deno.ts             ← inline declared minimal Deno surface
    bun.ts              ← mirrors node, separate module for symmetry
    detect.test.ts, node.test.ts ← 7 tests
  parsers/
    json.ts             ← jsonParser delegating to JSON.parse (no error wrapping; fileSource owns)
    registry.ts         ← ParserRegistry (readonly) + MutableParserRegistry types,
                          defaultRegistry, registerParser, withInjectedParsers, getParser
                          (format-aware install hints via PEER_DEPS map)
    registry.test.ts    ← 12 tests
  merge.ts              ← deepMerge(layers) with array policy + pollution guard
  merge.test.ts         ← 52 tests including prototype-pollution + purity suites
```

**Test count:** 159 passing across 5 files (`vitest run` clean).
**Type-check:** `tsc --noEmit` clean on both `tsconfig.json` and `tsconfig.test.json`.
**Lint:** `oxlint` clean.

---

## Workflow that's working

For each task:

1. **Spawn babyclaude** with `isolation: "worktree"` — creates a worktree at `.claude/worktrees/agent-XXX/` on a branch `worktree-agent-XXX` based on current main HEAD.
2. **Babyclaude implements** → commits inside the worktree → returns JSON output.
3. **Spawn spec-reviewer** (sonnet) — verifies acceptance criteria. Writes verdict to `.claude/reviews/spec/N.json`.
4. **If spec PASS, spawn code-reviewer** (opus) — quality dimensions with confidence scoring. Writes to `.claude/reviews/code/N.json`.
5. **If code review surfaces issues** — orchestrator (you) edits the worktree files inline, commits a `fix(...)` commit on the same branch.
6. **User runs `git merge` via `!` prefix** — see "merge-gate hook bug" below.

The orchestrator does NOT review (delegate to agents). The orchestrator does NOT directly merge to main (user runs the merge via `!`).

---

## Critical gotchas

### 1. merge-gate hook is broken (BSD grep)

The `merge-gate.sh` PreToolUse hook uses `grep -P` which is GNU-only; macOS BSD grep doesn't support it. Result: every `git merge` from the orchestrator gets blocked with a confusing error.

**Workaround:** ask the user to run `! git merge ...` themselves (the `!` prefix in the prompt runs bash directly, bypassing the hook). All Batch 1-3 merges used this pattern.

**Root fix (not yet done):** patch the hook script — likely change `grep -P '...'` to `grep -E '...'` or `awk`.

### 2. Don't `npm install` while a worktree is running

Worktree was created at main HEAD `093c364`. Then `npm install --save-dev zod` was run in the main worktree, modifying `package.json` + `package-lock.json` (uncommitted on main). The agent's worktree saw the OLD `package.json` (no zod) and modified it identically. This created a redundant change that needed reconciling.

**Fix:** before spawning any worktree-isolated agent that needs a new dep, install the dep in main and commit it FIRST. Then spawn agents — they'll see the new dep in their package.json.

### 3. Worktree base diverges from main as main moves forward

When tasks are reviewed inline + committed on the worktree branch + main has moved forward (e.g. another commit landed), fast-forward merge is no longer possible. Use `git merge --no-ff` for a merge commit (preserves topology), or `git cherry-pick` for linear history.

We've used `--no-ff` consistently.

### 4. State file location

- **Plan:** `.claude/kernel-outlines/outline-plan-2026-05-07-viper-ts.md`
- **State:** `.claude/execute-state.json` (machine-readable progress tracker)
- **Reviews:** `.claude/reviews/spec/N.json` and `.claude/reviews/code/N.json`
- **Worktrees:** `.claude/worktrees/agent-XXX/` (auto-cleaned when no changes; lingering ones are from successful tasks — `git worktree prune` to clean up)

---

## What to do FIRST in the resuming session

1. `cd /Users/kellen/Projects/viper-ts`
2. Read this file
3. Read `.claude/execute-state.json`
4. Verify state with: `git log --oneline --graph -15 && npx tsc --noEmit && npx vitest run 2>&1 | tail`
5. Optionally: patch `merge-gate.sh` (grep `-P` → `-E`) so future merges don't need `!` workaround
6. Begin **Batch 4** — see below

Optionally clean up old worktrees: `git worktree list` then `git worktree remove <path>` for any stale ones (Batch 1, 2, 3 worktrees are still on disk but inert).

---

## Batch 4 — what's next

6-way parallel fan-out, all dependent on tasks completed so far. None share files.

| #   | Task                                          | Files                                      | Notes                                                                                                                                                             |
| --- | --------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6b  | Env-key derivation from walker output         | `src/env-keys/derive.ts`, `derive.test.ts` | Walker output → env name list. Spec callouts: prefix + separator transform; case-preserving for original keys; SCREAMING_SNAKE for env names                      |
| 7   | overrideSource, defaultsSource, flagsSource   | `src/sources/{override,defaults,flags}.ts` | Three small sources. All synchronous reads. Use StandardPriority constants from types.ts                                                                          |
| 9   | fileSource                                    | `src/sources/file.ts`, `file.test.ts`      | Uses runtime + parser registry. Owns ParseError wrapping (parser throws raw → fileSource enriches with sourcePath)                                                |
| 10  | YAML parser (lazy + static-injection wrapper) | `src/parsers/yaml.ts`, `yaml-static.ts`    | Lazy `await import('yaml')` in yaml.ts; yaml-static.ts is the CSP-safe path consumers can `defineConfig({ parsers: { yaml: yamlStatic } })`                       |
| 11  | TOML parser                                   | `src/parsers/toml.ts`, `toml-static.ts`    | Same pattern as 10, using smol-toml                                                                                                                               |
| 14a | Watcher core: parent-dir + symlink + debounce | `src/watcher/index.ts`                     | Builds on `runtime.watchPath` primitive; adds 75ms debounce + symlink resolution + atomic-rename survival. Klaus called this a long-pole — schedule ahead of time |

**Recommended order:**

- Spawn 6b first (depends only on walker; pure logic; low risk)
- Then parallel: 7, 10, 11 (smallest, no shared concerns)
- Then 9 (depends on 4 + 3)
- Then 14a (depends on 3; long-pole)

OR: spawn all 6 in parallel if context budget permits.

**Peer deps to install before spawning 10 & 11:**

```
npm install --save-dev yaml smol-toml
```

Run this BEFORE spawning the agents so worktrees see the deps. Commit on main first.

---

## Batch 5+ summary (for downstream planning)

- **Batch 5** (2 tasks): `8` (envSource — needs 6b), `14b` (watcher edge-case fixtures — needs 14a)
- **Batch 6** (1): `12` (pipeline orchestrator — integrates 5, 7, 8, 9; the load-bearing task)
- **Batch 7** (3): `13` (errors polish), `15` (reload + diff + onChange/onError), `16` (CI matrix)
- **Batch 8** (1): `17` (TSDoc + expect-type tests)
- **Batch 9** (1): `18` (README)

---

## Conversation context tips for the resuming session

- Memory: this user has a private global CLAUDE.md preferring functional TS, Zod, "parse don't validate", oxlint+oxfmt, fastify. Tone is concise; avoid over-explaining familiar tech.
- The plan file in `.claude/kernel-outlines/` is the source of truth for acceptance criteria. Refer to it when writing per-task agent prompts.
- Per-task acceptance criteria need to be DERIVED for the agent prompt — the plan's task table is one row, but each task has implicit criteria from the broader plan sections (especially §2 success criteria and §3 architecture).
- For learning-mode tasks (5 and 15 were flagged as candidates; user didn't claim any): defer until execute time and ask if user wants to hand-write before spawning.
- Use `AskUserQuestion` to gate every batch start, every review-fix decision, and every merge.
