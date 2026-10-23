# Testing

Main Street runs its suites with [Vitest](https://vitest.dev/). Three projects
are defined in `vite.config.ts`:

| Project | Test files | Environment |
|---------|-----------|-------------|
| `unit` | `tests/**/*.test.ts` (excludes `*.browser.test.ts` and the `unit-cli` files) | Node, parallel (`maxWorkers: 4`) |
| `unit-cli` | the five files in `CLI_TEST_FILES` (`validate-storylines`, `storyline-graph`, `storyline-author`, `storyline-graph-svg`, `harness-cli`) | Node, serialized (`fileParallelism: false`) |
| `browser` | `tests/**/*.browser.test.ts` | Headless Chromium (Playwright) |

```bash
npm test                                                              # unit-cli + unit, one invocation
npx vitest run --project unit                                         # unit suite only
npx vitest run --project unit-cli                                     # serialized CLI suite
npx vitest run --project browser                                      # full browser suite
npx vitest run --project browser tests/e2e/<name>.browser.test.ts     # a single file
```

The `browser` project runs serially (`fileParallelism: false`) because the
headless Chromium/GPU context is shared; keep browser tests free of cross-file
state.

The `unit-cli` project is serialized by design (`fileParallelism: false` with
its own `sequence.groupOrder`): its tests cold-start a CLI through `vite-node`,
which takes 12-15 s on an idle host and regularly exceeds the 15 s `unit` budget
under CPU contention — running them concurrently produced spurious non-zero CLI
exits. If such a test times out, re-run rather than "fixing" a CLI that is fine
— and prefer raising the margin over shrinking the workload.

## Deterministic invocation: the CLI group runs first

`npm test` is a **single** Vitest invocation with two project filters:

```
tsx core/scripts/vitest-run-with-retry.ts --timeout-ms 720000 --project unit --project unit-cli
```

Do not split it into one invocation per project, and do not drop either
`--project` flag. The projects are sequenced by `sequence.groupOrder`:

- `unit-cli` — `sequence.groupOrder: 0` — runs first, alone.
- `unit` — `sequence.groupOrder: 1` — runs after the CLI group has finished.

**Why the CLI group runs first (MS-0MVK37SK5009M0NG).** Vitest 3.2.7 executes
`sequence.groupOrder` groups one after another with a bare `await` per group
and no per-group error isolation. When an earlier group's pool run *rejects* —
which a `unit` worker does when it misses the 60 s `onTaskUpdate` RPC window
under CPU contention (`[vitest-worker]: Timeout calling "onTaskUpdate"`) — the
group loop aborts and **every later group is silently dropped**, while the run
still reports the files it executed as passing. With the CLI group last, a
green `npm test` sometimes meant 375 of 380 non-browser files ran; the five CLI
files (including the Playwright `storyline-graph-svg` render guard) were simply
absent from the summary. Running the CLI group first makes its five files
unskippable: nothing has run yet that could reject. The parallel group is still
sequenced after it, so the two never share a pool run.

## Guarantee: every configured project runs

`vite.config.ts` wires `createProjectCoverageReporter()`
(`tests/tooling/vitest-project-coverage-reporter.ts`) into `test.reporters`.
The reporter records the files each project was *scheduled* to run
(`onTestRunStart`) and compares them with the files that actually ran
(`onTestRunEnd`). If any scheduled file never executed — a whole project coming
up empty, or a group dropped part-way — it prints and fails the run:

```text
[project-coverage-guard] FAIL: a configured Vitest project did not run every test file.
  project "unit-cli" executed 0 of 5 expected file(s); 5 never ran:
      - tests/main-street/harness-cli.test.ts
      …
```

A zero-file project can therefore never report green. Because the guard is
spec-driven, filtered runs stay quiet: `npx vitest run --project browser
<one file>`, `--changed` and `--shard` only "expect" the files their filters
selected.

The guard is a config-level reporter, so an explicit `--reporter=` on the
command line **replaces** the configured list (that is Vitest's behaviour, not
the guard's). Gate runs — `npm test`, `/skill:test`, the implement finish gate —
must not pass `--reporter`.

### What a green full-suite run must contain

```bash
npm test 2>&1 | grep -c '|unit-cli|'      # exactly 5 on a full run
```

- `Test Files <n> passed (<n>)` where `<n>` equals the number of non-browser
  `tests/**/*.test.ts` files (`find tests -name '*.test.ts' | grep -v browser |
  wc -l`).
- One `|unit-cli|` line for each of the five `CLI_TEST_FILES`.
- No `[project-coverage-guard] FAIL` line.

A green run that is missing CLI lines is not a passing suite, it is the
silent-skip defect above; re-run it. A `[vitest-worker]: Timeout calling
"onTaskUpdate"` transient on its own is re-tried once by
`core/scripts/vitest-run-with-retry.ts` and may be accepted, but the coverage
guard still refuses to call an incomplete run green.

## Prerequisites: Playwright Chromium

Some **unit** tests also launch Chromium (`storyline-graph-svg.test.ts` renders
Mermaid diagrams through `chromium.launch()`), so the Playwright browser binary
is required even when you only run `npm test`. Install it once per machine:

```bash
npx playwright install chromium           # verify with: npx playwright install --list
npx playwright install --with-deps chromium   # Linux: also install system libraries (may need sudo)
```

Playwright picks its browser from a **per-version** cache directory
(`~/.cache/ms-playwright/chromium-<revision>`), so the binary must match the
*installed* `playwright` package. When `node_modules` is refreshed ahead of the
committed `package-lock.json`, the browser for the new revision is missing and
the suite fails with:

```
Error: browserType.launch: Executable doesn't exist at
  .../ms-playwright/chromium_headless_shell-<revision>/.../chrome-headless-shell
```

`npm test` runs `src/scripts/check-playwright-chromium.ts` as its `pretest`
hook. That check is launch-free (package resolution + one `existsSync` + a
`package-lock.json` read) and fails in under a second with the exact
remediation commands instead of an opaque Vitest unhandled error. It also warns
when `node_modules` drifts from the lockfile — in that case run `npm ci` first,
then `npx playwright install chromium`.

## Import shared helpers through the core aliases

The engine and its shared test helpers live in the `core` git submodule
(`core/tests/…`), **not** in this repository's `tests/` tree. Import them
through the path aliases returned by `resolveCoreAliases()` in
`core/scripts/vite-game-discovery-plugin.ts`, for example:

```ts
import { waitForScene } from '@core-tests/helpers/waitForScene';
```

Do **not** use a relative path such as `../helpers/waitForScene`: there is no
`tests/helpers/` directory in this repository, so the import cannot be resolved
at collection time. Vitest then reports the whole file as a suite import
failure —

```
Failed to import test file tests/e2e/<name>.browser.test.ts:
Failed to resolve import "../helpers/waitForScene"
```

— and every test in that file is lost, not just one. Use a core alias for any
core-owned module; the full map is:

| Alias | Resolves to |
|-------|-------------|
| `@core-engine` | `core/src/core-engine` |
| `@card-system` | `core/src/card-system` |
| `@rule-engine` | `core/src/rule-engine` |
| `@ui` | `core/src/ui` |
| `@ai` | `core/src/ai` |
| `@balance-cards` | `core/src/balance-cards` |
| `@core-scripts` | `core/scripts` |
| `@core-tests` | `core/tests` |
| `@core-gym` | `core/example-games/gym` |

A stale relative helper import in
`tests/e2e/main-street-cheat-smoke.browser.test.ts` was corrected to the
`@core-tests` alias in MS-0MV1HAUPR004REDJ; the file header keeps a short note
so the failure mode is not reintroduced.

## One Phaser copy: `resolve.dedupe` and the `./core` submodule

Shared runtime dependencies (`phaser`, `tone`) must resolve to **exactly one**
copy: this repo's root `node_modules`. `vite.config.ts` enforces that with
`resolve.dedupe: ['phaser', 'tone']` (the same guard `core/vite.config.ts`
carries).

Why it matters: this repo composes the engine from the `./core` submodule,
which normally has **no `node_modules` of its own**, so core-owned modules (for
example `@ui`) resolve `phaser` up to the root install. A single
`npm install` **inside `core/`** — for instance from a core-repo session working
in the same checkout — creates a second `phaser` at `core/node_modules/phaser`.
Every core-owned module then loads its own copy, which is a *different module
id* from the one the Node-environment unit tests register:

- the tests mock Phaser with `vi.mock('phaser')`, resolved from the **test
  file** against the root copy;
- a core module importing its own copy is not covered by that mock, so real
  Phaser is evaluated during collection and the file dies with
  `ReferenceError: window is not defined` (17 animator/HUD test files, see
  MS-0MVK3SF54006Y6A6).

Consequences for day-to-day work:

- **Never run `npm install`/`npm ci` inside `./core`** for the purpose of a
  build or test run here — install at the repo root (`npm ci`) and let the
  root copy serve the engine. `npm run engine:sync` (part of `npm run build`)
  only moves the submodule checkout; it does not install dependencies.
- If the suite suddenly fails with a wall of `ReferenceError: window is not
  defined` collection errors, check for `core/node_modules` before debugging
  the tests: `ls -d core/node_modules`.
- `tests/tooling/phaser-single-copy.test.ts` guards the contract — it fails if
  the dedupe is dropped (including by a re-scaffold) or if a nested copy
  produces a second module identity.

## Troubleshooting: ENOSPC (`System limit for number of file watchers reached`)

A full-suite run that fails with `ENOSPC: System limit for number of file
watchers reached` from vite-node CLI subprocesses (spawned by the `unit-cli`
tests) is an **environmental** failure, not a test-code or product-code defect.

The commit under test typically passes the full suite via independent gates
(implement finish + pre-push hook); all individual tests pass when run in
isolation. The trigger is host inotify-watch exhaustion: orphaned long-running
processes (e.g. a hung `npx vitest run --project browser` from a dead session)
plus several long-lived `vite --host` dev servers can consume most of
`fs.inotify.max_user_watches` (default 65536). Each additional worktree adds
recursive watchers on the project root, so with many sibling worktrees a
full-suite run trips the limit mid-collection.

Diagnosis and remediation (no code changes required):

1. Check the watch budget: `cat /proc/sys/fs/inotify/max_user_watches`.
2. Find the top consumers — per-process inotify watch counts can be derived
   from `/proc/<pid>/fdinfo/<fd>` entries of type `anon_inode:inotify`.
3. Kill the orphaned consumer(s) once confirmed hung (parent session dead,
   e.g. `ppid=1`, no output for hours).
4. Re-run the suite; it should be green.

Reference work item: MS-0MVA50KJN009X30C.

