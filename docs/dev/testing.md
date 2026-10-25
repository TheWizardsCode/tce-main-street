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

Every one of these invocations — including the changed-scope gate's direct
`npx vitest run <files>` calls — passes through the **engine-checkout
preflight** first (below).

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
tsx scripts/run-tests.ts --timeout-ms 720000 --project unit --project unit-cli
   └─ tsx core/scripts/vitest-run-with-retry.ts --project unit --project unit-cli
        └─ vitest run --project unit --project unit-cli
```

Do not split it into one invocation per project, and do not drop either
`--project` flag. `scripts/run-tests.ts` exists only to enforce the coverage
verdict (below); all arguments are forwarded unchanged to the engine retry
runner, which still owns retry/masking semantics and the wall-clock timeout.
Pouring `npm test` straight at `core/scripts/vitest-run-with-retry.ts` removes
the enforcement, which is exactly how a green gate with 376 unexecuted files
was produced on 2026-10-23.

The projects are sequenced by `sequence.groupOrder`:

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

### The verdict is enforced outside Vitest

A reporter can only print and set `process.exitCode`; it cannot override the
engine retry runner's acceptance decision. That matters: the runner accepts any
non-zero run whose summary reads `Test Files N passed (N)` when a transient
signature is present, *without knowing which files the run intended to execute*.
On 2026-10-23 a retried full-suite run executed **0 of 376** `unit` files, printed
`Test Files 5 passed (5)`, hit the guard's `FAIL` message — and was still
accepted as `accepted-transient` (exit 0).

So the guard also writes a machine-readable verdict (`PROJECT_COVERAGE_REPORT`),
and `scripts/run-tests.ts` enforces it after the runner exits:

| Runner exit | Verdict | `npm test` result |
|-------------|---------|-------------------|
| 0 | complete | pass |
| 0 | incomplete | **fail** (guard message printed) |
| 0 | missing | **fail** ("the guard did not run") |
| non-zero | any | fail with the runner's exit code |

The engine-side fix (teach `vitest-run-with-retry.ts` the expected file set) is
tracked separately as `CG-0MVL21CVM003VK5H` in the engine repository; until it
lands, this wrapper is what makes an incomplete run impossible to call green.

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
## Load-tolerant wait budgets (browser tests)

A browser test that polls for an animation-gated outcome is racing **two**
clocks: the production cap that paces the work (a bounded deferral, a transfer
duration) and the host's ability to run `requestAnimationFrame`. Under CPU
contention the frames are starved, the animation stretches past its nominal
duration, and a hand-guessed poll budget turns a correct scene into a red test.
The retry runner
(`core/scripts/vitest-run-with-retry.ts`) does **not** retry a
`waitForCondition` timeout — it only retries the three known transient
contention signatures — so a single starvation spike fails the gate. Accepting
the flake is not an option; the budget has to be derived.

### The rule

**Never hard-code a wait for an animation-gated outcome.** Import the
production cap the wait races and pass it to the shared helper
(`@core-tests/helpers/waitForCondition`, sibling of `waitForScene.ts`):

```ts
import { waitForCondition } from '@core-tests/helpers/waitForCondition';
import { INCOME_COLLECTION_CAP_MS } from '../../src/scenes/MainStreetAnimatorTiming';
import { DRAG_TRANSFER_DURATION_MAX_MS } from '../../src/scenes/MainStreetConstants';

await waitForCondition(() => scene.state.turn > beforeTurn, {
  capMs: INCOME_COLLECTION_CAP_MS,          // the cap the scene may consume
  floorMs: END_TURN_STARVATION_MARGIN_MS,   // fixed starvation margin
  label: 'turn to advance after end-of-turn presentation',
});
```

The helper derives the budget

```
budget = max(round(capMs * starvationFactor), capMs + floorMs)
// defaults: starvationFactor = 1.5, floorMs = 5 000
```

and **enforces `budget > capMs` in code**, throwing when a caller configures a
poll that is not strictly longer than the cap it documents as racing. The
timeout message keeps the greppable shape
`Timed out waiting for <label> after <budget>ms (cap <capMs>ms)`.

- `starvationFactor` scales with the cap (useful for the long 16 000 ms
  end-of-turn deferral);
- `floorMs` supplies a fixed margin that a tiny cap cannot express (the
  1 500 ms transfer cap needs a fixed margin, not a multiplier), so
  `MainStreetScene.browser.test.ts` passes a per-class `floorMs`:
  24 000 ms for the end-of-turn wait and 12 000 ms for the transfer waits.

### The 60 s headroom rule

`budget + scene-boot allowance` must stay inside the browser project's
`testTimeout` (`60 000`, and a `20 000` boot allowance is documented in the
guard). A wait that breaks this rule dies in the hook with an unattributed
timeout instead of failing with its own label — so the largest legal
end-of-turn budget is 40 000 ms. Above ~2× CPU oversubscription the scene's own
choreography can outlive the hook; that ceiling is measured and recorded in the
soak envelope below rather than papered over with a longer poll.

### The guard

`tests/tooling/wait-budget-guard.test.ts` (node `unit` project, no browser)
fails the build when:

1. any derived budget is not strictly greater than the production cap it races;
2. the helper accepts an under-cap option set for the real constants;
3. a documented wait stops passing `capMs: <the cap it races>` (or a raw
   `timeoutMs` literal reappears for it, or it is routed back through the
   per-file `waitForConditionLegacy`);
4. the **effective** budget at the call site (including any `floorMs`
   override) plus the boot allowance no longer fits the browser `testTimeout`.

The guard imports the cap constants rather than restating budgets, so retuning
a cap moves the check with it.

### Proving it

Deriving a budget does not prove it survives a loaded host; the soak below is
the proof. Run at minimum:

```bash
/skill:test --type unit   # the guard (fast, node only)
/skill:test --type soak   # 20 consecutive runs on the quiet host
```

and the under-load profile when touching a wait or its cap:
`/skill:test --type soak-load`.

## Proving browser-wait reliability: the soak profiles

Browser waits in `tests/main-street/MainStreetScene.browser.test.ts` are paced by
the scene's own bounded deferrals, so their budgets are derived from production
caps rather than hand-guessed (see `tests/tooling/wait-budget-guard.test.ts`).
Deriving a budget does not *prove* it survives a loaded host, so the reliability
claim is proven by a repeatable soak:

```bash
/skill:test --type soak        # 20 consecutive runs on the quiet host
/skill:test --type soak-load   # 5 runs under $(nproc) imposed CPU burners
```

Both profiles are project-local test types declared in
`.pi/skills_extensions/test/extension.json` and run
`scripts/soak-browser-waits.sh`, so the soak goes through the test skill (and its
run cache) rather than an ad-hoc `npx vitest` loop. Running the harness directly
is equivalent:

```bash
scripts/soak-browser-waits.sh --runs 20            # quiet-host soak
scripts/soak-browser-waits.sh --runs 20 --load     # soak under imposed load
```

Each run invokes the **canonical gate runner**
(`npx tsx core/scripts/vitest-run-with-retry.ts --project browser
 tests/main-street/MainStreetScene.browser.test.ts`), so retry and hang-bound
semantics match the dev-push gate exactly — the soak measures the gate, not a
look-alike.

Behaviour:

- **fail-fast** — the first failing run aborts the soak, prints that run's full
  output, exits non-zero, and keeps its log at
  `results/soak-browser-waits-<ts>-run-<n>.log` for triage;
- **`--load`** — spins up `$(nproc)` CPU burners for the whole soak (teared down
  by an `EXIT` trap, so `Ctrl-C` never leaves burners behind), and records the
  load average before, the per-run peak and the value after;
- **summary** — a markdown report of every run's wall time, pass/fail and peak
  load is written to `results/soak-browser-waits-<ts>.md` (`results/` is
  gitignored). The evidence — run count, load averages, wall times, summary
  path and any anomaly — belongs in the work item; the generated file is a local
  artefact, not a committed one.

The harness logic itself (run loop, fail-fast, burner lifecycle, summary) is
unit-tested in `tests/tooling/soak-browser-waits.test.ts` with mock runners, so
it needs neither Chromium nor a real 20-run soak. `SOAK_RUNNER_CMD` is a
test-only override. `SOAK_BURNERS` overrides the burner count: the default is
`$(nproc)`, and a **smaller** count is the documented probe for a host whose
ambient load already exceeds one runnable task per core (see the measured
envelope below). A real evidence run states the burner count it used.

### Measured envelope (2026-10-24, 16-core host)

The soak was run on a host concurrently shared with other agent suites, so the
"quiet" profile still saw peak load 15.3:

| Profile | Burners | Peak load | Runs | Result |
|---|---|---|---|---|
| quiet | 0 | 15.3 | 20 | **20/20 pass** (58-95 s per run) |
| load | 8 | 23.6 | 5 | **runs 1-2 pass** (129-137 s); run 3 failed once ambient load reached 31.3 |
| load | 16 | 32.8 | 5 | run 1 failed at the 40 000 ms end-of-turn budget |

Both under-load failures were the *same* wait — `turn to advance after
end-of-turn presentation` — and only at load ≥ ~31 (≈2× oversubscription): the
end-of-turn income choreography is sequential scene work, so at that load it
runs longer in wall-clock time than the 60 s browser `testTimeout` can
accommodate once the scene boot allowance is included. The derived budget is
therefore already at its ceiling (40 000 ms = 16 000 ms cap + 24 000 ms margin,
+ 20 000 ms boot = the 60 000 ms hook), and every other wait in the file passes
at that load. Raising the hook or the budget further is a design decision
recorded on the work item, not a test-side tweak.

When you re-run the soak, record the burner count next to the result — an
under-load pass at 8 burners on a host already at load 20 is a stronger
statement than one at 16 burners on an idle host.

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

## Engine checkout preflight: which engine did this test compose?

A Vitest run composes whatever `./core` happens to be checked out — and in a
fresh worktree that is the gitlink the branch recorded at fork time, which can
silently predate the engine pin in `configs/engine-pin.json`. So the root
`vite.config.ts` registers a `test.globalSetup`
(`tests/tooling/engine-checkout-precheck.ts`, MS-0MVO26G5H0054SNV) that every
invocation inherits — `npm test`, the changed-scope gate's direct
`npx vitest run <files>` calls and the dev-push browser gate — and fails the
run loudly when `./core` is not the pinned engine or a descendant of it,
naming the composed SHA, the pin SHA and the `npm run engine:sync`
remediation. On a pass it logs the composed engine identity (short SHA plus
`git describe` tag when available) alongside the pin, once per process.

The check is offline (local commit graph only — `git merge-base
--is-ancestor`, never a fetch or a cached `origin/dev` ref) and sub-second.
A dirty `./core` is warned about but never fails the run. Deliberate bypass:
`ENGINE_CHECKOUT_CHECK=warn|off`, logged every time it is used. The same code
path is available manually as `npm run engine:check` (exit 0/1). The Vitest
wiring is a documented LOCAL SURGICAL ADDITION to the engine-owned
auto-generated config, held by
`tests/main-street/vite-config-engine-check-guard.test.ts`; the pass/fail
branches are covered by `tests/main-street/engine-checkout-precheck.test.ts`
(offline fixtures). See the composition matrix in
[docs/dev/build-and-release.md](build-and-release.md#composition-matrix-which-engine-does-each-invocation-compose).

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

