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

### Renderer choice in browser tests

Most browser tests pin `type: Phaser.CANVAS` on purpose: the Canvas renderer
is roughly 10× faster under SwiftShader, and `TestGamePool` relies on that for
CI throughput. Keep that default unless the test is *about* the WebGL
renderer.

`createCardGame` (and therefore `createMainStreetGame`) defaults to
`Phaser.AUTO`, which picks WebGL on any GPU-capable browser — headless
Chromium included. A browser test that omits `type` therefore exercises the
WebGL path.

Renderer-specific behaviour must be asserted on an explicit renderer, because
Phaser 4 diverges between them. The important known divergence is masks:
`GameObject.setMask` is **Canvas-only** in Phaser 4 — under WebGL it logs
`"Phaser.GameObjects.Components.Mask.setMask: This method is not supported in
WebGL. Create a Mask filter instead."` and returns, so the object renders
unclipped. `@ui/ContainerClip` hides that difference behind
`createContainerClip()`; see the "Viewport clipping" bullet in
`src/README.md`.

`tests/main-street/webgl-renderer-clipping.browser.test.ts` is the reference
WebGL browser test. It:

- boots with an explicit `type: Phaser.WEBGL` and asserts the renderer really
  is WebGL (a silent Canvas fallback would otherwise pass);
- asserts clipping **behaviourally** with `renderer.snapshotPixel()` probes —
  content inside the clip rect is painted, content outside is not, `clear()`
  un-clips and `setRect()` re-clips — rather than only inspecting the scene
  graph;
- boots the real `MainStreetScene` and `GymCardIndexScene` on WebGL and
  asserts **zero** `setMask … not supported in WebGL` warnings from **any**
  source — this repo, the `./core` submodule and bundled libraries included.
  Every clipping surface, core-owned panels included, migrated to the
  renderer-aware `@ui/ContainerClip`, so there is no core-path exclusion left to
  hide a Canvas-only mask behind: a single leftover `setMask` anywhere fails the
  file (MS-0MVU03UEC000BX1O);
- probes each clipping surface with `renderer.snapshotPixel()` — the Help panel,
  the Settings panel, an overlay-dialog content area and the gym card index each
  paint inside their own scroll rect and nowhere outside it.

Pixel probes are cheap for single pixels (`snapshotPixel`) but expensive for
areas — prefer scene-graph assertions plus a handful of pixel probes over
full-frame snapshots.

### The launcher is generator-owned — never hand-edit `./main.ts`

`./main.ts` is not hand-authored: it is byte-for-byte what the engine-owned
`core/scripts/game-repo-scaffold.ts` → `renderMainTs()` emits.
`tests/main-street/main-ts-scaffold-drift.test.ts` fails the unit suite the
moment the committed file drifts from that output — that guard is the repo's
check for this contract, not a raw scaffold run.

**`npm run scaffold` is safe on this repo — it is scoped to `main.ts`**
(MS-0MVU03V1V0096L4O, MS-0MVWGI4CB0055IT0). The script passes
`--only main.ts --force`, so the engine-owned generator classifies every other
generated file (`package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`,
`configs/game.json`) as `skip-local` or `unchanged`, writes none of them,
performs no `example-games` → `src/` path rewrite, and creates no `core`
symlink. The launcher comes out byte-identical when it already matches
`renderMainTs()`, so a run is a no-op for the committed tree and the drift guard
below still holds the contract. `tests/tooling/scaffold-non-destructive.test.ts`
pins this: it runs the repo's own `scaffold` arguments against a temporary copy
of the wiring files and fails if anything but `main.ts` changes, if a diverged
`main.ts` is *not* regenerated, or if `--dry-run` writes at all. Use
`npm run scaffold` (or the same command with `--dry-run` to preview the
classification) when a generator or pin change should be re-emitted into
`./main.ts`. **Never** invoke the generator without `--only` here: a full run
still rewrites every generated file — the template behaviour fresh and
extracted game repos rely on (MS-0MVU03V1V0096L4O). **Never hand-edit**
`./main.ts`: a hand edit is silently erased by the next scaffold, together with
any comment explaining it, which is exactly how the `type: Phaser.AUTO` launcher
switch was reverted once (MS-0MVU03TR0006KZDH). Launcher commentary belongs in
the generator or in `docs/`. Full contract:
[build-and-release.md](build-and-release.md).

The `unit-cli` project is serialized by design (`fileParallelism: false` with
its own `sequence.groupOrder`): its tests cold-start a CLI through `vite-node`,
which takes 12-15 s on an idle host and regularly exceeds the 15 s `unit` budget
under CPU contention — running them concurrently produced spurious non-zero CLI
exits. If such a test times out, re-run rather than "fixing" a CLI that is fine
— and prefer raising the margin over shrinking the workload.

## End-to-end switch-over gate (build, engine, suite, WebGL smoke)

A renderer or clipping change crosses the composed engine, the build and the
renderer, so no single unit file proves it. Run the whole gate on the **final
commit** of the change and record the evidence on the work item:

```bash
npx vitest run --project unit tests/main-street/main-ts-scaffold-drift.test.ts  # main.ts == renderMainTs()
npm run engine:check                                 # composed ./core at the pin
npm run build                                        # engine:sync + tsc + vite build
npm test                                             # unit + unit-cli
npx vitest run --project browser tests/main-street/MainStreetScene.browser.test.ts
npx vitest run --project browser tests/e2e/main-street-no-console-errors.browser.test.ts
```

`/skill:test` runs the three commands declared in `.pi/test-config.json`
(`suiteCommands`: `npm test` plus the two browser files above), so it is the
source of the audit-accepted full-suite evidence. The WebGL reference file is
additionally run as its own group: `/skill:test --group webgl-clipping-browser`.

### The manual half: WebGL launcher smoke

The browser suites boot the scenes directly through their factories. The
**launcher** — `main.ts`'s `Phaser.AUTO` config, the game selector and the
composed engine — is only proven by booting `npm run dev` and inspecting the
running game:

1. `npm run dev`, then open the printed URL in a Chromium browser with WebGL
   enabled.
2. In the DevTools console, `window.__PHASER_GAME__.renderer.type` must be `2`
   (`Phaser.WEBGL`), never `1` (the Canvas fallback).
3. Play Main Street and scroll each clipping surface past its visible height —
   the **Help** panel, the **Settings** panel, an **overlay dialog** and the
   **Gym** card index — and confirm the content is clipped at the surface's
   bounds: no paint over the heading, the footer, the scrollbar track or the
   surrounding scene.
4. The browser console must show **no** `setMask … not supported in WebGL`
   warning.
5. Record the renderer type, the surfaces checked, the warning count and the
   commit in the work-item comment.

The automated equivalent is
`tests/main-street/webgl-renderer-clipping.browser.test.ts` (forced
`Phaser.WEBGL`, pixel probes per surface, zero-warning capture). A smoke note
confirms the **real launcher** boots that same path; it does not replace the
probes.

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

### Interaction gates between the animation and the advance

The day no longer always advances straight off the end-of-turn animations. In
normal single-player play the deferred closing is gated on the **Turn Summary
dialog** (MS-0MVP46Q8X003419R, parent MS-0MVL6HMDP004WI41): once every animation
(phased income show + incident reveal) has completed the scene presents a
dialog, and `finalizeTurn` (checkpoint + `startTurnPhase`) runs only when the
player clicks **[ Next Turn ]**. Reduced-motion, tutorial, replay/headless and
competitive closings are never gated — they keep the existing auto-advance
pacing. See
[`docs/game/ux-visual-audio.md`](../game/ux-visual-audio.md#turn-summary-dialog-and-the-closing-gate).

So a browser test that drives a real single-player end-of-turn and then waits
for `scene.state.turn` to advance must dismiss the dialog first, otherwise it
polls a state the scene is deliberately holding. Use the shared helper
(`tests/main-street/helpers/turn-summary-dialog.ts`):

```ts
import {
  dismissTurnSummaryDialog,
  dismissTurnSummaryDialogIfPresent,
} from './helpers/turn-summary-dialog';

// …after the animation-related waits…
await dismissTurnSummaryDialog(scene); // waits for the dialog, clicks [ Next Turn ]
await waitForCondition(() => scene.state.turn > beforeTurn, {
  capMs: INCOME_COLLECTION_CAP_MS,
  floorMs: END_TURN_STARVATION_MARGIN_MS,
  label: 'turn to advance after end-of-turn presentation',
});
```

A test whose subject *is* the gate asserts that the dialog is present and the
day is still held before dismissing it (`tests/main-street/turn-summary-gate.test.ts`,
`MainStreetScene.browser.test.ts`). `dismissTurnSummaryDialogIfPresent` is a
`false` no-op when no dialog is up — the ungated modes (tutorial, reduced
motion, replay/headless) — so calling it unconditionally is safe.

### The 60 s headroom rule

`budget + scene-boot allowance` must stay inside the browser project's
`testTimeout` (`60 000`, and a `20 000` boot allowance is documented in the
guard). A wait that breaks this rule dies in the hook with an unattributed
timeout instead of failing with its own label — so the largest legal
end-of-turn budget is 40 000 ms. Above ~2× CPU oversubscription the scene's own
choreography can outlive the hook; that ceiling is measured and recorded in the
soak envelope below rather than papered over with a longer poll.

**The deferral cap is enforced on wall clock (MS-0MVMKEU2000639TG, decision C).**
The end-of-turn safety cap (`INCOME_COLLECTION_CAP_MS`, 16 000 ms) is applied by
the shared `deferUntilIncomeCollected` helper through a `Date.now` deadline and a
`setTimeout` watchdog, not through the scene clock's `delayedCall` re-polls. The
consequence is a documented semantic: a hidden or backgrounded document forces
the day start after the cap instead of stalling until the tab paints again
(producer Q2 = 1) — the cap exists to bound a stall, and nothing is visible
while hidden. The 40 000 ms end-of-turn budget and the headroom rule are
unchanged, and the choreography pacing is untouched; the wall-clock enforcement
removes the *deferral* leg from the starvation race, which is what the measured
envelope below reflects (and where it still ends).

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

#### Re-measured after the wall-clock deferral cap (2026-11-02, 16-core host)

The wall-clock cap (`deferUntilIncomeCollected`, MS-0MVMKEU2000639TG decision C)
changed *which* wait fails first and how the day start behaves in a hidden tab,
but it did not lift the ≈2× ceiling. Nine 16-burner soak attempts
(`--runs 5`, fail-fast) on a host shared with sibling agent suites, so peaks
swung 28.60-58.04 from start loads of 6.71-47.95:

| Attempt peak load | Runs pass/fail | Result |
|---|---|---|
| 47.46 / 56.76 / 56.73 / 49.01 / 51.20 | 0 / 1 | dialog wait failed; the two most oversubscribed attempts also broke 1-3 transfer waits |
| 49.32 | 1 / 1 | run 1 **passed** at 28.98 |
| 58.04 | 1 / 1 | run 1 **passed** at 36.03 |
| **30.77** | **2 / 1** | runs 1-2 **passed** (29.98 / 30.77), run 3 failed at 29.37 |
| **28.60** | 0 / 1 | failed on the first run — the dialog wait **only**; the other 19 tests passed in 2-19 s |

Every failure is the same wait — `Turn Summary dialog after end-of-turn
presentation` at its cap-derived 40 000 ms budget — and it now trips at peaks
*below* the pre-change failure point (28.60 and 29.37 versus 34.86). The cause is
structural, not a regression: the Turn Summary gate (MS-0MVP46Q8X003419R)
presents the dialog *before* the day advance, behind the income choreography and
the incident reveal, and both remain scene-clock paced (pacing is a shipped
feature and deliberately unchanged). The wall-clock cap bounds the deferral leg
— and unit contract tests prove it forces the continuation within one poll
interval of the cap on a frozen scene clock — but it cannot bound the animation
chain in front of the dialog.

So the ≈2× ceiling still applies to the *Turn Summary dialog* wait, and the
16-burner gate can still go red on a loaded shared host. The remediations on the
table are test-side: drive the Enter test on the reduced-motion path and keep the
deferred-income property in a separate contract test (filed as
MS-0MVZI4OXL0050RPP), or accept the measured envelope as the documented design
limit. Neither is delivered by the cap change alone.

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

### Two failures this preflight catches

1. **A clone that cannot resolve the pinned commit.** When `./core` is a stale
   clone whose object database does not contain the pin sha, every project
   aborts before a single test runs and the `project-coverage-guard` reports
   `project "<name>" executed 0 of N expected file(s)` for each project. The
   preflight names the composed SHA, the pin SHA and the `npm run engine:sync`
   remediation (MS-0MVO26G5H0054SNV); fetching the missing commit into `./core`
   clears it. Worktrees get a fresh submodule checkout, so they are the usual
   place this surfaces.
2. **A node-environment import-chain regression.** `npm test` runs the `unit`
   and `unit-cli` projects in the node environment, so anything they import must
   not value-import Phaser — Phaser's device detection touches `window` at
   module scope. `tests/tooling/ui-node-import-guard.test.ts` (parent item
   `MS-0MVQO6N34007DHP8`) value-imports `@ui/shakeIllegalMove` with real Phaser
   resolution and **no mocks**, so a regression fails the suite at collection
   with `ReferenceError: window is not defined` instead of surfacing as a score
   of unrelated scene-suite failures. Do not "fix" a red guard with a mock:
   fix the engine import graph and re-pin.

## The finish gate: composition, cache, timeout and queue

`implement.py finish` (the implement skill) runs **build → test → commit** in
a worktree before pushing a work item to `dev`. Three of its behaviours
interact in a way that produced a 47-minute false gate failure
(`MS-0MVSB1OVW00178W6`); this section records how they fit together so a
failed gate is read correctly.

### Composition: the build re-pins the engine, and that churn is not the item's

1. **Build** runs `npm run build`, whose first step is `npm run engine:sync`.
   When the engine `dev` tip has advanced past the commit the worktree pinned,
   `engine:sync` checks out the new engine into `./core`, rewrites
   `configs/engine-pin.json` and **stages** the pin together with the `core`
   gitlink (`core/scripts/engine-sync.mjs`). That is the intended dev-build
   behaviour — the pin tracks the engine `dev` tip (policy
   `CG-0MVO268500071BPI`) — but it is **build-originated churn** relative to
   the item's own changes.
2. **Test** then evaluates a tree that is dirty because of the build, not
   because of the item. The test-cache key is **`HEAD` plus the content of
   every dirty path**, so build-originated churn stops the run from matching
   any pre-warmed green entry: the gate runs the full suite from scratch even
   for a documentation- or evidence-only item.
3. **Commit** must not sweep that churn into the item's commit unless the item
   itself changed the engine composition (producer decision Q2=A on
   `MS-0MVSB1OVW00178W6`; framework fix `SA-0MVL2NH1G0094FA2`). The gate
   validates and commits the composition in `HEAD` and records the composed
   engine SHA plus whether the suite ran or was cache-served, so a green
   verdict is traceable to the engine it actually exercised.

### The timeout is per command, and shared with `git push`

`timeoutPerCommand` from `.pi/test-config.json` bounds **each** entry of
`suiteCommands` individually — not their aggregate — and the same value also
bounds the `git push` step of finish
(`implement.py:_resolve_test_timeout`). Measured on this host: the full
suite took **2846.6 s** under load while the config declared 1800 s, and a
2215 s gate run was killed and reported as `reason: unknown` with
`failures: []`. The floor is now **3600 s** (2846.6 s + 26 % headroom,
rounded up to a whole minute) and is enforced by
`tests/tooling/test-config-timeout-guard.test.ts` — lowering the config below
the floor fails the suite, so the config, the guard and this paragraph cannot
drift apart. The same guard pins the **shape** of the config: the
three-command full suite and every named `groups` entry in
`EXPECTED_GROUP_NAMES`. Adding a group is therefore a two-file change — the
config **and** the pin — and forgetting the pin fails the guard rather than
silently shrinking the targeted-scope mechanism (`MS-0MVZGAEF6004Q8XD`).

### Queue wait is separate from test time

Tests run under a host-wide semaphore (`TEST_MAX_CONCURRENCY=2`, shared by
all agent projects). Waiting for a slot is its own duration, distinct from
suite elapsed time; on this host slot waits measured 1040–2400 s and surfaced
as `notice_code: slot_busy` / `reason: slot_contention`, not as suite time.
Reporting the wait separately from suite time, and classifying timeouts and
kills without `reason: unknown`, is `SA-0MVTET8KQ0031R6Z` (slot fairness is
`SA-0MVSJX5HS002JDHI`). When a gate fails, read the verdict before retrying: a
code failure, a timeout/kill and a slot wait are three different problems with
three different fixes.

### Changed scope is currently the full suite in this repo

`implement.py finish` first tries a named group from `.pi/test-config.json`,
then a file-level selector, and falls back to the **full suite** with a logged
warning when no subset can be selected — with `suiteCommands` declared, that
fallback is what normally fires today. Restoring a targeted selection for this
stack (vitest/TypeScript-aware mapping; `groups` honoured even when
`suiteCommands` is present, which continues to define only the full suite) is
`SA-0MVL7YOMJ006UMDO`; when it lands, the finish log reports
`scope: changed` with the selected commands instead of the full fallback.

The engine-composition preflight above is the complementary guard: this
section is about what the gate *does*, the preflight is about which engine a
run *composed* (`npm run engine:check`,
`tests/tooling/engine-checkout-precheck.ts`; the release pin contract lives in
`tests/main-street/engine-submodule-sync.test.ts`).

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
carries). That config is **auto-generated by the scaffold template**
(`core/scripts/game-repo-scaffold.ts` → `renderViteConfig`), and the template
emits the dedupe itself (CG-0MVPWPWLA008FTDJ). It therefore arrives here by a
deliberate engine pin bump — an `npm run scaffold` run is scoped to `main.ts`
(`--only main.ts --force`, MS-0MVWGI4CB0055IT0) and does **not** re-emit
`vite.config.ts` (MS-0MVK4TS31000YNFL); use
`--only vite.config.ts --force` deliberately if that file ever has to be
re-rendered.

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
- `tests/tooling/phaser-single-copy.test.ts` guards the **checked-in config**
  — it fails if the dedupe is dropped from `vite.config.ts` or if a nested
  copy produces a second module identity. The **template** side is guarded in
  the core repository by the `renderViteConfig` and `scaffoldGameRepo` cases in
  `core/tests/scripts/game-repo-scaffold.test.ts`, which assert the rendered
  source and the on-disk `vite.config.ts` both carry the guard inside the
  `resolve` block (after `alias: resolveCoreAliases(coreRoot)`), so a
  re-scaffold cannot regress it unnoticed.

## Dev-session transcript persistence (`POST /api/transcripts`)

Every game-over stores a transcript in the browser (`TranscriptStore`) and
mirrors it to disk through a dev-server middleware:

```
POST /api/transcripts  ->  data/transcripts/<gameType>/<gameType>-<ISO>.json
```

`vite.config.ts` registers the middleware from the engine's
`transcriptPersistPlugin()` for `command: 'serve'` runs only, and never when
`process.env.VITEST` is set (the plugin writes to disk, so a test run must not
have that side effect). The scaffold template emits the identical registration
(`core/scripts/game-repo-scaffold.ts` → `renderViteConfig`, core item
CG-0MVSIB5LH0069LB3). An `npm run scaffold` run is scoped to `main.ts`
(`--only main.ts --force`, MS-0MVWGI4CB0055IT0), so it does not re-emit this
wiring: the registration arrives by a deliberate engine pin bump, and a change
to it must be pulled in explicitly with `--only vite.config.ts --force`.

Two arms guard it:

- `tests/tooling/vite-transcript-plugin-registration.test.ts` loads the real
  `vite.config.ts` factory and asserts the plugin is present for `serve`,
  absent under `VITEST`, and absent for a production build — plus an
  in-process dev-server smoke that POSTs a transcript and asserts HTTP 200 and
  the JSON file under a temp `destRoot` (the repo's own `data/` is never
  touched).
- `tests/e2e/main-street-no-console-errors.browser.test.ts` saves a transcript
  in the browser and asserts the console stays free of
  `[TranscriptStore] … 404` warnings.

The disk mirror is deliberately quiet: the request is issued only where the
endpoint can exist (`import.meta.env.DEV`), and a failure is reported **at most
once per store instance** — an absent endpoint (404/405) or an unreachable
server at `console.debug`, any other non-2xx at `console.warn`.

**A `404` on `POST /api/transcripts` in a dev session** therefore means the
running `vite.config.ts` predates this wiring (an out-of-date generated
config): re-run the scaffold or copy the
`...(command === 'serve' && !process.env.VITEST ? [transcriptPersistPlugin()] : [])`
entry into `plugins`. Full contract: `core/docs/DEVELOPER.md` § Transcript
Persistence.

## Troubleshooting: dev server died mid-session (`[vite] server connection lost`, WS retries, `ERR_CONNECTION_REFUSED`)

A dev session that ends with a flood of browser console noise — `[vite] server
connection lost`, repeated `WebSocket connection to ws://<host>:3000/ failed`
HMR retries and `net::ERR_CONNECTION_REFUSED` for every card SVG /
`csv-checksum.json` request — means the **Vite dev server process is gone**, not
that the assets are missing. Proven on this host (see below): the same assets
return HTTP 200 from a live server, and the failure signature disappears when
the server is restarted (MS-0MVREB31W004F48D).

### Signature

1. `[vite] server connection lost` / `[vite] http proxy error` in the page.
2. HMR WebSocket reconnects fail: `WebSocket connection to 'ws://<host>:3000/' failed`.
3. Every subsequent asset request fails with `net::ERR_CONNECTION_REFUSED` —
   roughly one line per card SVG, plus `csv-checksum.json` (and, in a
   Main Street session, the `[MainStreetLifecycleManager] Could not fetch
   csv-checksum.json` note — now a quiet `console.debug`, see AC3).
4. No server-side crash trace is visible in the terminal that ran
   `npm run dev` beyond the process having exited.

### Fast triage (30 seconds)

```bash
ss -ltn | grep :3000
```

- **A listener is present** → the server is alive; the disconnect is transient
  (HMR full-reload). Refresh and continue.
- **No listener** → the server is gone, not the assets. Restart `npm run dev`;
  the same URLs, including every card SVG, return 200 again from the live
  server. (A live-server probe is the definitive check: start `npm run dev`
  and `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/<svg-url>`.)

Do **not** file a bug for the cascade: it is the symptom of a process death,
not a code defect. The two bounded classes that *are* app-owned — the
`/api/transcripts` 404 and repeated expected-condition warnings — are fixed
and guarded (AC1–AC3): a red line in a dev-session console now means
something is actually wrong.

### Likely causes on this host and remediation

The cause is machine pressure, not app code:

- **Memory pressure / swap exhaustion.** At report time this host had 7.3 GB of
  8 GB swap in use; a long-lived `vite --host` server (which also holds the
  SVG/card asset caches in memory) is the first process to lose its memory
  headroom when RAM+swap runs out. Check `free -m` / `swapon --show`; a server
  killed under this pressure leaves no trace in the app log, only the
  browser-side cascade. Note the bounded finding below: on the reported boot
  swap was exhausted **without** a kernel/`systemd-oomd` OOM kill, so exhaustion
  is the ambient condition rather than the proven kill mechanism.
- **Concurrent dev servers and browser suites.** Sibling repos (e.g. core
  worktrees, other `tce-*` game repos) running their own `vite --host` and
  Playwright browser suites multiply baseline memory and CPU.
- **Many `.worklog` worktrees.** Each worktree duplicates watchers and, when
  active, its own processes; 10+ worktrees materially raise the working set.
- **inotify exhaustion is a sibling cause** — see the ENOSPC section below for
  that signature.

Host-level remediation (swap headroom, orphaned dev servers, worktree hygiene)
is covered by the runbook below (MS-0MVS0FNLH003VBMW); this section documents
the diagnosis so the cascade is not re-filed as a bug.

### Console errors that are not app defects (browser extensions)

A dev-session console can also show messages the app can neither cause nor
suppress, because they come from a loaded browser extension. The known class is:

```
Uncaught (in promise) Error: A listener indicated an asynchronous response by
returning true, but the message channel closed before a response was received
```

Signature: the stack includes an extension hook such as `installHook.js`, and
there is no corresponding `chrome.runtime` / `window.postMessage` usage in the
app.

Verification (MS-0MVREB31W004F48D, AC4a): the guard
`tests/e2e/main-street-no-console-errors.browser.test.ts` runs the game in the
Vitest `browser` project — Playwright's headless Chromium, which loads **no
extensions** — and asserts a clean console on boot *and* on a transcript save.
That run produces no such error, so the message is extension-origin and is
**out of scope** for app code: do not add it to the guard's benign-pattern list
(that would weaken a real guard), and do not file it as an app bug. Verify with
an extension-free run (`npx vitest run --project browser
tests/e2e/main-street-no-console-errors.browser.test.ts`, via `/skill:test`)
before concluding the same about any new variant.

## Host-pressure hygiene runbook (MS-0MVS0FNLH003VBMW)

A long-lived `vite --host` session on this shared development host competes with
sibling repositories, agent worktrees and test suites for RAM and swap. When
the server dies mid-session that is a **host-capacity event**, not an app
defect. This runbook bounds the cause, prevents the pressure, and restarts
cleanly. Everything here is read-only until an explicitly approval-gated
cleanup step.

The single entry point is the committed, read-only detector:

```bash
scripts/hygiene_check.sh            # human report
scripts/hygiene_check.sh --json     # stable JSON (see the script header)
```

It reports three things and never prunes, deletes or kills: the worktree
inventory (registered git worktrees vs orphaned directories under
`.worklog/worktrees/`), swap/memory pressure, and dev-server processes with
their cwd ownership. Its classification logic is covered by
`tests/tooling/hygiene-check.test.ts`.

### Findings: what killed the server

The candidate causes were resolved against this host's journal and process
state. The report-window boot can no longer be re-inspected (journal
rotation), so the determination rests on the intake-time inspection plus the
boots that are still observable.

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| Kernel OOM killer / `systemd-oomd` killed the `vite`/`node` process | Ruled out for the report window | `journalctl -b -g 'Out of memory\|oom-kill\|Killed process'` reports no entries on the boot in which the cascade was seen, nor on the four boots since; `journalctl -u systemd-oomd -b` shows service starts only, never a kill action. The journal's most recent OOM kill (2026-10-03) predates the report. Swap *was* exhausted (7.3 GB of 8 GB) with no OOM kill, so exhaustion is the ambient pressure, not the proven kill mechanism. |
| Manual or agent kill (terminal/session teardown, `wl cleanup-worktree`, `implement.py finish`/`abort` cleanup) | Undetermined, bounded | `wl cleanup-worktree` only signals processes it has *registered* for a worktree path, and 0 worktree-scoped processes were tracked at intake; `implement.py finish` targets its own worktree with documented self-exclusion guards (`cleanup_worktree_processes`). The affected server ran from the **main checkout**, which neither path reaps. The journal records no signal for the dead process, so the specific kill cannot be attributed retrospectively; the mechanisms that *could* have issued it are bounded to those listed above plus pane/terminal teardown when the owning session ends. |
| `:3000` port conflict | Ruled out (structurally a startup failure, not a mid-session kill) | Vite binds the port during startup: a conflicting listener yields `EADDRINUSE` (or a fallback port) at launch, so the browser URL would never have worked in the first place. The reported signature is a *working* session that later drops, and `ss -ltn` showed no listener after the death — consistent with a process death, not a bound port. |

Practically: treat the cascade as **process death under host pressure**. Do not
file an app bug for it; use the fast triage above, then this runbook.

### Pre-flight checks (before starting a dev server)

```bash
scripts/hygiene_check.sh --json   # inventory + pressure + dev servers, one shot
free -m                           # RAM headroom (want > 4 GB available)
swapon --show                     # swap use (want < 50 % of the device)
ss -ltn | grep -E ':(3000|4173)\b' # an existing dev/preview listener?
pgrep -af 'vite --host'           # how many servers are actually running?
```

Start the dev server only when all four hold:

1. **No listener** on `:3000` — a second `vite --host` cannot share the port and
the browser will attach to whichever process won the race.
2. **Swap under 50 %** and **more than 4 GB RAM available**; `hygiene_check.sh`
grades this as `pressure: ok`. A `warning` grade is tolerable for a short run;
a `critical` grade means fix the pressure first — a server started there will be
the first casualty.
3. **No orphaned dev server** (`dev_servers.orphaned_count` 0): a server whose
cwd is a removed worktree or a stale path is holding memory for nobody.
4. **No orphaned directory is `in_use`** — if one is, a live shell is anchored
there and the cleanup step below must skip it.

### Concurrency cap (documented guideline, deliberately not enforced)

Per producer decision Q3 = a this is guidance plus the pre-flight checks above;
no launcher or registry refuses a second server.

- **One `vite --host` dev server per host at a time.** The port is host-wide,
  so a second checkout reuses the first session (point the browser at it) or
  waits — it never starts its own.
- **At most one `vite preview` (port 4173) alongside it**, and stop the preview
  before a browser suite: preview plus Playwright plus a dev server is the
  peak-memory combination observed on this host.
- **Do not run the full or browser suite while a dev soak is running.** Vitest
  workers are the largest single memory consumer on this host; use
  `/skill:test --type unit` for cheap feedback.
- **Re-run the pre-flight checks after an idle break** — sibling agents start
  their own servers, so a session that was alone an hour ago may not be now.

### Worktree hygiene: registered vs orphaned (approval-gated)

A directory under `.worklog/worktrees/` is *registered* when
`git worktree list` names it; everything else is a leftover. `hygiene_check.sh`
classifies each leftover as:

- **`safe-to-prune`** — empty, or containing only the cwd-anchor placeholders an
  agent writes so a dead session's shell still resolves (`.cwd-placeholder`,
  `.cwd-anchor`, `.keep`, `.recover_cwd`, `__session_recreate__.tmp`);
- **`needs-review`** — contains anything else (a stale checkout, a broken `.git`
  link, unknown files). A human decides; the procedure never touches these.

Procedure (producer approval required before any deletion; this is the
approval-gated step — nothing above it mutates the host):

1. Snapshot the before state: `scripts/hygiene_check.sh --json > /tmp/hygiene-before.json`.
2. Review `worktrees.orphaned`; list the `safe-to-prune` candidates and their
   entries in the work item (or PR) and **get explicit producer approval**.
3. Skip any candidate with `in_use: true` — a live process still has it as its
   cwd, and removing the directory breaks that shell.
4. For each approved candidate, confirm and remove only what was reviewed:

   ```bash
   candidate=.worklog/worktrees/<name>
   git worktree list --porcelain | grep -F "$candidate" && echo 'REGISTERED - stop'
   ls -A "$candidate"          # expect nothing, or only the reviewed placeholder
   rmdir "$candidate"          # empty directory
   # placeholder-only: delete exactly the reviewed placeholder file first
   rm "$candidate/.keep" && rmdir "$candidate"
   ```

5. Clear stale administrative entries for worktrees that are already gone:
   `git worktree prune` (never `--force`).
6. Re-run `scripts/hygiene_check.sh --json` and record the before/after counts
   on the work item. Host evidence belongs in work-item comments, not in
   committed files (`.worklog/` is gitignored).

**Hard limits:** never `git worktree remove --force`, never
`git worktree prune --force`, never `rm -rf`, never remove a registered
worktree, and never drop a stash as part of this procedure. A stash or a
`needs-review` directory is triaged on its own work item first (see the
implement skill's dirty-main-checkout recovery playbook).

Note the honest scope of the win: the leftovers are usually placeholder stubs,
so the memory reclaimed directly is small. The value is an accurate inventory
(fewer directories for watchers, agents and humans to reason about) and
stopping a stale server from being mistaken for a live session.

### Restart and swap-reclamation procedure

1. **Identify the corpse and the strays:** `scripts/hygiene_check.sh` → dev
   servers section (pid, age, RSS, owner).
2. **Confirm ownership** from `owner`: `orphaned-worktree` / `stale-path` are
   safe to stop once recorded; `main-checkout` or `registered-worktree` means
   someone is probably still using it — confirm before stopping.
3. **Stop the server:** `Ctrl-C` in the terminal that ran `npm run dev`; if that
   terminal is gone, `kill -TERM <pid>` and only use `kill -KILL` if SIGTERM is
   ignored. Never kill a browser suite or `vitest`/`tsx` process you do not own.
4. **Reclaim swap:** swap only frees when its pages stop being used, so stopping
   the servers, browser suites and stray node processes is the lever. Verify
   with `swapon --show`. A device reset (`swapoff -a && swapon -a`) needs root
   **and** free RAM greater than swap in use — never run it on this host while
   swap is nearly full.
5. **Verify the pressure dropped:** `free -m`, `swapon --show`,
   `scripts/hygiene_check.sh --json` (`memory.pressure`).
6. **Restart and prove the server, not the assets, was the failure:**

   ```bash
   npm run dev
   curl -s -o /dev/null -w '%{http_code}\n' \
     http://localhost:3000/assets/cards/5_of_diamonds.svg   # expect 200
   ```

7. **Soak it** (the AC4 bar): leave the server up for at least 30 minutes while
   the card asset tree is loaded, probing periodically — every probe must return
   `200` and the server must stay alive:

   ```bash
   for i in $(seq 1 31); do
     curl -s -o /dev/null -w '%{http_code} ' \
       http://localhost:3000/assets/cards/5_of_diamonds.svg
     sleep 60
   done
   ```

   A `200`-only run with no `[vite] server connection lost` cascade is the
   evidence; record the observations (not the numbers) on the work item.

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

