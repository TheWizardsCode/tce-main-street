# Build & release: engine sync vs pinned release builds

Main Street composes the Tableau Card Engine as a git submodule at `./core`.
This repo has **no CI beyond the npm builds** — `npm run build` is the
verification vehicle — so the build scripts themselves resolve which engine is
compiled (MS-0MVCRGKZY007DIED).

## The pin policy: the pin tracks the engine `dev` tip

One explicit, producer-decided policy governs every statement below
(MS-0MVN1OAG1005JWFX):

> **The engine pin tracks the engine `dev` tip**, and **the pin and the `./core`
> gitlink always travel together** — one actor, one moment, one commit.

A pin that lags the tip is therefore a **genuine failure**, not tolerated drift.
The pin used to be written by hand at release time only, so it lagged whenever
the engine advanced and `engine:verify` reported a `PIN MISMATCH` that was
indistinguishable from real drift. Since the engine-side fix
(`CG-0MVO268500071BPI`) `engine:sync` writes the pin whenever it advances
`./core`, and `engine:verify` tells a lag apart from a bad pin. The local suite
asserts the behaviours this document describes:
`core/tests/scripts/engine-sync.test.ts` (engine-side policy suite) and
`tests/main-street/engine-submodule-sync.test.ts` (local contract).

**Current pin:** read `configs/engine-pin.json` — it is the single source of
truth for the engine commit this build composes, and `npm run engine:check`
prints the pin and the composed `./core` commit side by side. No sha is
hard-coded here on purpose: `engine:sync` re-pins on **every** `npm run build`,
so a literal sha in prose goes stale the moment the engine `dev` tip advances.

That drift class is what `MS-0MVQO6N34007DHP8` closed —
`tests/main-street/engine-pin-docs.test.ts` fails if a currency claim
re-acquires a literal sha. The pin tracks core `dev`; the short-lived hold it
superseded (with its historical shas) is described under
[Retired: the `0409c1eb` engine hold](#retired-the-0409c1eb-engine-hold).

## Two build policies

| Script | Engine behaviour | Purpose |
|--------|------------------|---------|
| `npm run dev` | `engine:dev-sync` **first**: the **soft** variant of `engine:sync` — advances `./core` to the tracked branch tip and re-pins when it is clean, and **warns + serves the current checkout** when `./core` is dirty (never blocks the dev server) | **Interactive dev start**: serve the latest engine without giving up a dirty engine working tree. |
| `npm run build` | `engine:sync` **first**: advances `./core` to the latest remote head of the branch it tracks **and re-pins** `configs/engine-pin.json` to that commit, then type-checks and bundles | **Dev builds always compose the latest engine**, so behaviour is tested against current engine code; the pin keeps tracking it. |
| `npm run build:electron` | Same dev sync (pin included), Electron `vite` mode | Desktop dev builds. |
| `npm run build:release` | `engine:verify` **instead**: pins `./core` to exactly the SHA in `configs/engine-pin.json`, then type-checks and bundles | **Deterministic, reproducible release builds** — compile exactly the recorded engine commit. |

The standalone npm scripts are independently invocable:

```bash
npm run engine:dev-sync # dev start: soft sync — dirty ./core is skipped with a warning, never blocks
npm run engine:sync     # dev: dirty-guard + `git submodule update --remote core` + re-pin
npm run engine:verify   # release: dirty-guard + pin check (lag vs bad pin) + exact checkout
```

Rule of thumb: **`engine:sync` for anything that ends in a commit or a build,
`engine:dev-sync` for an interactive dev server, `engine:verify` for a release
build.** Only the dirty-guard outcome differs between the two sync modes.

They wrap the engine-owned script `core/scripts/engine-sync.mjs` (re-scaffolded
into this repo's submodule by the game-repo scaffold — never edit a game-repo
copy by hand).

## Which branch `./core` tracks

`.gitmodules` declares a `branch` for the submodule. For the engine this is
**`dev`** — the branch the engine's own development lands on. Configured
explicitly so `git submodule update --remote` follows dev (the remote's
default branch is `main` and would otherwise lag dev).

## Dev sync (`engine:sync`) — never clobber, always re-pin

1. **Dirty guard:** if `./core` has uncommitted changes (tracked
   modifications, staged files, or untracked files), the build **fails
   loudly** with the offending paths — `git submodule update` is never allowed
   to overwrite local engine work.
2. On a clean checkout: `git submodule update --init --remote core` fetches
   the latest remote head of the tracked branch and checks it out (detached,
   like any build-time submodule refresh).
3. **Re-pin (mechanical, not manual):** when the checkout moved, the pin is
   rewritten to the new engine HEAD and **both the pin and the `core` gitlink
   are staged together**, so a single commit records them consistently and they
   can never diverge. This is the same "pin and gitlink travel together"
   invariant the release path relies on; a second no-op sync leaves the pin
   byte-identical (nothing writes unless the SHA moved).
4. **Offline fallback (degraded mode only):** if the remote is unreachable,
   the build warns and continues with the current `./core` checkout instead of
   failing (dev work stays possible without network). Nothing moved, so the pin
   is left untouched. This is an **exceptional** accommodation for genuinely
   offline dev work — it is **never** a way to hold the pin back. A pin
   deliberately kept behind the engine tip is a genuine failure under the pin
   policy above, not a supported state (see the retired hold below).

After a sync the superproject records the new engine commit **and the matching
pin** as pending changes — commit them together (never one without the other).
A repo without a `configs/engine-pin.json` is never given one by `engine:sync`;
a repo is pinned once the pin file exists, and `engine:sync` maintains it from
then on.

## Dev start (`engine:dev-sync`) — soft sync, never blocks

`npm run dev` runs `npm run engine:dev-sync` before `vite --host`
(`MS-0MVZJ3JLG0074ACP`). It is the same engine-owned script in **soft mode**
(`core/scripts/engine-sync.mjs sync --soft`), with exactly one difference:

- **Dirty `./core` → skip and warn.** Instead of the loud failure that
  `engine:sync` raises, a dirty submodule produces a `WARNING`, **no git
  operation at all**, no pin write, and exit code 0 — the dev server boots on
  your engine working tree. A dirty engine is the normal state while working
  engine-side, and a dev start must never block or clobber it.
- **Clean `./core` → identical to `engine:sync`.** It advances the checkout to
  the tracked branch tip and, when the pin exists, rewrites and stages the pin
  with the gitlink.

Consequences to keep in mind:

1. **A dev start on a clean-but-behind checkout can move `./core` and stage the
   pin + gitlink.** That is the pin policy working as intended — commit the pair
   together with a message naming the engine SHA. Do not start a long dev
   session and then sweep the bump into an unrelated commit.
2. **Every dev start needs the network.** Offline falls back to the current
   checkout with a warning and still serves.
3. **It is opt-in and never gates anything.** Builds and releases keep the
   strict `engine:sync` / `engine:verify` paths, so a red or lagging engine is
   still caught where it matters.

## Retired: the `0409c1eb` engine hold

For a short period the pin was deliberately held at `0409c1eb` while the engine
`dev` tip advanced, because the newer tip (`34e0ab6d`, then `19f30ac7`) made the
`@ui/shakeIllegalMove` import chain value-import Phaser and killed 23 unit
suites under node (`ReferenceError: window is not defined`). During that window
builds were forced into the offline fallback so the pin could not drift
(MS-0MVPWS6WB008WP79).

**The hold is over.** The engine-side fix (`CG-0MVQQ2M8E003FQMZ`, core
`193f947f`) keeps the `@ui` chain Phaser-free for node consumers, and this repo
re-pinned to core `dev` in `MS-0MVRAH4BZ0073U1T` (commit `eee6fef3`, pin
`f5c0a1b1…` — the sha is cited as history only; the pin has advanced by design
since, see `configs/engine-pin.json`). Do **not** keep `./core` behind the
tip or force the offline fallback in order to hold the pin; the
node-environment regression guard
(`tests/tooling/ui-node-import-guard.test.ts`) fails loudly if that import
chain ever regresses. Tracking item: `MS-0MVQO6N34007DHP8`.

## Release verify (`engine:verify`) — pin from `configs/engine-pin.json`

1. **Local-modification guard:** same loud refusal as dev sync — a release
   must compile a clean pinned engine.
2. **Pin required:** `configs/engine-pin.json` must exist with a single `sha`
   field. The release process creates it once; dev `engine:sync` then keeps it
   tracking the engine tip. A release build never writes the pin.
3. **Pin must match the remote target:** the pinned SHA is compared against
   the tip of the tracked branch. Both failure modes fail the build loudly
   (release verification requires network access so the pin can be compared),
   with distinct, actionable diagnoses:
   - **Lag** — the pin resolves on the tracked branch but is an *ancestor* of
     the tip by N commits. The message says so and says how to re-pin: run
     `engine:sync` (or re-pin by hand) and commit the pin **with** the gitlink.
   - **Bad/foreign pin** — the pin does not resolve on the tracked branch at
     all (typo, deleted commit, or a commit only on another branch). The
     message names the tracked branch and its tip so the pin can be corrected.
4. **Exact checkout:** `git checkout --detach <pin>` puts `./core` at exactly
   the pinned engine commit, then the build compiles against it.

## Composition matrix: which engine does each invocation compose?

Every test/build invocation composes whatever `./core` happens to be checked
out. Worktrees created by the implement tooling only run
`git submodule update --init --recursive`, which checks out the gitlink
recorded by the commit they were forked from — a commit that can silently
predate the pin — so a green suite can report success without ever seeing the
pinned engine code. The engine-checkout preflight (`npm run engine:check`,
wired as the Vitest root `test.globalSetup`;
`tests/tooling/engine-checkout-precheck.ts`) makes the composed engine
explicit on every run and fails loudly when it is not the pin or a
descendant of it.

| Invocation | `./core` checkout | Gate |
|---|---|---|
| `npm run dev` | tracked branch tip when `./core` was clean (soft sync), otherwise the current checkout | `engine:dev-sync` soft guard — warns and continues on a dirty submodule |
| `npm test` (Vitest `unit` + `unit-cli`), and a full-suite run via `/skill:test` | the checkout present in `./core` — the preflight must accept it (pin, or a descendant of the pin) | preflight fail → run aborts |
| changed-scope gate (`npx vitest run <files>`, run by `implement.py finish`) | the checkout present in `./core` — same preflight | preflight fail → run aborts |
| browser-project runs (`npx vitest run --project browser …`) | the checkout present in `./core` — same preflight | preflight fail → run aborts |
| `npm run build` / `build:electron` / the implement.py finish build step | engine dev head **after** `engine:sync` (the pin follows it) | `engine:sync` dirty guard |
| `npm run build:release` / `engine:verify` | **detached at the pin** after `engine:verify` | `engine:verify` pin match + dirty guard |
| freshly created worktree | whatever gitlink its branch recorded, **until** `engine:sync` runs | the preflight fails such a test run loudly, naming the composed SHA, the pin SHA and the exact remediation |

### What the finish gate commits

`implement.py finish` builds, tests and commits inside a worktree, and its
build step runs `npm run engine:sync` first — so the build may advance `./core`
and re-pin `configs/engine-pin.json`, exactly as the dev workflow intends. That
churn is **build-originated**, not work the item did. Unless the item itself
changed the engine composition, the finish commit excludes the `core` gitlink
and the `configs/engine-pin.json` churn: the gate validates and commits **the
composition in `HEAD`**, and records the composed engine SHA plus whether the
suite ran or was cache-served, so a green verdict always describes the engine
the commit actually carries (producer decision Q2=A on `MS-0MVSB1OVW00178W6`;
framework fix `SA-0MVL2NH1G0094FA2`). An engine bump is therefore a deliberate,
reviewable commit, never a side effect of a documentation change.

This does not weaken the pin policy `CG-0MVO268500071BPI`: `npm run build` keeps
sync-and-re-pin, `npm run build:release` keeps `engine:verify`, and any commit
that *does* bump the engine still carries the pin and the gitlink together.
What the finish gate stopped doing is bundling an unrelated bump into someone
else's item. The full gate semantics — cache key, per-command timeout, queue
wait — are documented in [Testing](testing.md#the-finish-gate-composition-cache-timeout-and-queue).

### Preflight behaviour and the bypass

The preflight decides from the **local commit graph only** (`git merge-base
--is-ancestor`): it never fetches and never consults a cached `origin/dev`
ref, so airgapped worktrees with stale refs still gate correctly. It accepts
the pin or any descendant of the pin (the post-`npm run build` checkout the
dev workflow deliberately creates), fails on a behind or diverged checkout,
on a pin commit missing from the local `./core` clone, on an unreadable pin
file and on an uninitialised `./core`, and merely warns on a dirty `./core`.
The failure message names the composed SHA, the pin SHA and the `npm run
engine:sync` remediation.

Deliberate bypass: `ENGINE_CHECKOUT_CHECK=warn|off` downgrades (warn) or
suppresses (off) the failure; every use is logged. The Vitest wiring is a
documented LOCAL SURGICAL ADDITION to the auto-generated `vite.config.ts`,
held in place by `tests/main-street/vite-config-engine-check-guard.test.ts`;
a re-scaffold cannot silently drop the gate.

## Dev-push gate (current state)

This checkout runs the **v2** pre-push hook (`MS-0MVTI7F5R009OQ14`), activated
with `git config core.hooksPath .githooks`. The gates it actually enforces are:

1. **Branch policy** — a push whose current branch is `main`, `master` or
   `HEAD` is refused.
2. **Context-budget regression gate** — `docs/dev/context-budget.thresholds.json`
   pins the startup context surface (here: `AGENTS.md` only — this repo ships
   no `AGENTS_GLOBAL.md` and no `skill/` tree) and a push that exceeds it is
   refused. Regenerate the thresholds and commit them with the change that
   moved the surface:

   ```bash
   python3 ~/.pi/agent/skills/context-audit/scripts/measure_context.py \
     --repo-root . --include-hidden \
     --write-thresholds docs/dev/context-budget.thresholds.json
   ```

3. **Worklog sync** — `wl sync` runs from the main checkout; it is a no-op
   inside a linked worktree.

**There is no full-suite step in this repo's hook.** `implement.py finish`
deliberately defers the full suite to a "dev-push gate", so a `dev` push from
this repo is **not** full-suite-gated: a red tree can reach `dev` unless someone
runs `/skill:test --scope full` first. The framework ships the v2 hook to
non-SorraAgents projects by design; the game-repo full-suite variant, the
scaffold wiring and the `install_pi.sh` selection are tracked in
**`CG-0MW0KURL8002XOV9`** (engine store). Until that lands:

- run `/skill:test --scope full` before a `dev` push instead of assuming a gate
  did it;
- do **not** treat a missing full-suite cache entry as a gate that failed to
  record itself — no gate here produces one.

Activation is **per-clone** local config (`core.hooksPath` is never cloned), so
a fresh clone silently loses all three gates until the `git config` line is run
again. Verify from the checkout that will push with
`git config --get core.hooksPath` (expect `.githooks`) and
`git rev-parse --git-path hooks` (expect `.githooks`, resolved against the
current worktree root); the full check is in
[Testing](testing.md#dev-push-gate-activation).

## Updating the engine / releasing

- **Dev:** just build — `engine:sync` follows engine `dev` automatically and
  re-pins `configs/engine-pin.json` to the advanced checkout, staging the pin
  with the `core` gitlink. Commit the two together; the pin never lags the
  gitlink in a committed tree.
- **During a release:** bump the version and confirm
  `configs/engine-pin.json` equals the engine SHA the release is compiled
  against (by policy this is the engine `dev` tip; `engine:sync` has already
  moved it there), then `npm run build:release`. If the pin lags, the build
  fails with the lag diagnosis naming the tip and the re-pin step. The
  submodule pointer and the pin travel together.

### The release derived-files step restores the pin with the gitlink

The ship release (`/skill:ship release`) regenerates derived version files on
the merged tree: it runs `npm run build` and commits the tracked files the
build rewrote (subject `Regenerate derived version files for v<version>`), so a
consumer repo whose derived version file is tracked ships it matching the bumped
`package.json`. In this repo `npm run build` runs `engine:sync` first, which
advances `./core` and rewrites `configs/engine-pin.json` to the advanced commit
— so the regeneration step must keep **both** artefacts at the composition the
merged commit records.

The step restores, for every staged submodule gitlink it returns to its
recorded entry, any staged **tracked** file whose `HEAD` content carries the
recorded (gitlink) SHA and whose staged content carries the advanced one — the
pin file — back to `HEAD`, both the index entry and the working-tree file. The
derived-files commit therefore carries neither a pointer bump **nor** a pin that
disagrees with the recorded pointer. This replaces the earlier claim that
gitlink exclusion alone "keeps pin/pointer invariants intact": excluding the
pointer without also restoring its pin is exactly what shipped a disagreeing
pin and failed the release pin contract (the derived-files commit that broke
v0.1.25 pinned the build's advanced engine while the gitlink stayed at the
merged commit).

The rule is generic — derived from the recorded/advanced SHA pair alone, with
no per-repo pin-path list and no `package.json` schema; a full or
≥7-character abbreviated SHA matches — so a repo without submodules behaves
byte-for-byte as before. A pin the release deliberately bumped in an earlier
commit survives, because the restore returns to `HEAD`, so the deliberate
engine advance stays a separate reviewable commit (never reversed by
regeneration). The regeneration log line names the restored pointer(s) and pin
file(s).

Afterwards the working `./core` checkout may legitimately stay ahead of the
restored gitlink: the engine-checkout preflight accepts the pin or any
descendant of it, so only the **committed** artefacts must agree. The contract
that `git ls-files -s core` equals the pin's `sha` is guarded by
`tests/main-street/engine-submodule-sync.test.ts` ("release pin contract
(AC3)"); the generic rule and its regression fixture live in the framework
(`skill/ship/scripts/release/regenerate-version.js`, SA-0MW6LOXBO0008706,
extending the pointer exclusion of SA-0MVO274QN006GXGQ).

## The game-repo scaffold entry point: `npm run scaffold`

Every game repo's scaffold entry point is **`npm run scaffold`** — in this
repo it runs the engine-owned generator from the `./core` submodule
(`package.json` → `scripts.scaffold`):

```bash
tsx ./core/scripts/game-repo-scaffold.ts --game main-street \
  --game-repo-root . --core-root ./core --only main.ts --force
```

The `--core-root ./core` construction is what makes it game-repo-safe: the
generator is driven from the repo's own submodule clone, so a game repo never
needs (or touches) a sibling core checkout or a root `scripts/` tree of its
own. **`scaffold:game` and `scaffold:games` are core-checkout-only npm
scripts**: they live in the engine's own `package.json` (where
`scripts/game-repo-scaffold.ts` exists) and are filtered out of generated game
repos by the scaffold template — a game repo must never declare or run them
(MS-0MVO30VXS002A1Z0; guarded by
`tests/tooling/scaffold-scripts.test.ts` and
`tests/main-street/scaffold-docs-drift.test.ts`).

## The launcher (`main.ts`) is generator-owned

`./main.ts` is not hand-authored: it is exactly what the engine-owned generator
emits (`core/scripts/game-repo-scaffold.ts` → `renderMainTs()`), and
`npm run scaffold` rewrites it verbatim (MS-0MVU03TR0006KZDH). Two failure
modes are silent, and both have already reverted the renderer once:

- **Hand edits are erased.** The CANVAS→AUTO rationale and the ContainerClip
  renderer notes used to be comments inside `./main.ts`. The next
  `npm run scaffold` deleted them, and the renderer line reverted with them.
- **Generator drift reverts every launcher.** A generator that emits
  `type: Phaser.CANVAS` turns every re-scaffolded game repo back into Canvas,
  where Phaser 4's Filter/mask pipeline is unavailable (CG-0MVTQ3WPV003ZECA).

Rules that follow from this:

- **Launcher commentary lives in the core generator or in `docs/`** — never as
  a hand edit to `./main.ts`. The generator carries the AUTO rationale; the
  renderer-behaviour notes live in
  [`docs/dev/testing.md`](testing.md#renderer-choice-in-browser-tests).
- **Change the launcher by changing the generator** (or the engine pin), then
  run `npm run scaffold`. Never hand-patch the generated file.
- `tests/main-street/main-ts-scaffold-drift.test.ts` enforces the rule: the
  committed `./main.ts` must be byte-for-byte `renderMainTs()` output, so any
  hand edit fails the unit suite instead of being silently erased later.
- **`npm run scaffold` is scoped to the launcher.** The script runs the
  generator with `--only main.ts --force` (`package.json` → `scripts.scaffold`),
  so a run writes `./main.ts` and nothing else: every other generated file is
  classified `skip-local` (or `unchanged`) and left untouched, and none of the
  full-run side effects happen — no `core` symlink, no shared-asset or
  app-icon links, no legacy `example-games/…` → `src/` path rewrite. This is
  the default for this repo because it carries deliberate LOCAL SURGICAL
  ADDITIONS in `package.json`, `vite.config.ts`, `tsconfig.json` and
  `index.html`; the blanket overwrite is what made the old “run it on a clean
  tree, diff, then revert everything but the file you meant” rule necessary
  (`MS-0MVVGUYYG004XXOB`, superseded).

  What the generator now offers (`core/scripts/game-repo-scaffold.ts`,
  MS-0MVWGI4CB0055IT0): `--only <file,…>` selects generated files, `--force`
  permits overwriting a **selected** file that has diverged from the template,
  `--dry-run` classifies (`create` / `update` / `unchanged` / `skip-local`) and
  writes nothing, `--json` emits that classification machine-readably, and
  `--migrate-game-paths` opts in to the path rewrite (off by default, and
  mutually exclusive with `--only`). A **full** run (no `--only`) still
  overwrites every generated file — that is what fresh and extracted game
  repos rely on to receive template updates — so never invoke the generator
  here without `--only`. Use `npx tsx ./core/scripts/game-repo-scaffold.ts
  --game main-street --game-repo-root . --core-root ./core --only <file>
  --force` when a specific generated wiring file genuinely has to be
  re-emitted, and `--dry-run` first to preview the classification.

  `tests/tooling/scaffold-non-destructive.test.ts` guards the contract: it runs
  this repo's own `scaffold` script arguments against a temporary copy of the
  wiring files and fails if anything but `main.ts` changes (and if `--dry-run`
  writes at all). Wiring changes therefore arrive by a deliberate engine pin
  bump — never as a side effect of regenerating the launcher.

## Tests

`tests/main-street/main-ts-scaffold-drift.test.ts` guards the launcher rule
above (committed `./main.ts` === `renderMainTs()` output, and the renderer line
is `Phaser.AUTO`); `tests/main-street/renderer-capability.test.ts` guards the
generator side (the engine really does emit AUTO and ships the renderer-aware
clip helper).

`tests/main-street/engine-submodule-sync.test.ts` covers the dirty-state
guard, the sync-writes-the-pin / no-op / offline-fallback behaviour and the
lag-vs-bad-pin diagnostics (unit, offline fixtures); the canonical script
suite lives in the engine repo (`core/tests/scripts/engine-sync.test.ts`) and
is the authority on the policy wording. The behaviours documented above are
the ones those two suites assert.
`tests/main-street/engine-checkout-precheck.test.ts` covers the composition
preflight (pin / ahead / behind / missing-pin / uninitialised / bypass,
offline fixtures) and
`tests/main-street/vite-config-engine-check-guard.test.ts` guards the Vitest
wiring.

`tests/main-street/storylines-doc-drift.test.ts` guards the engine story-line
reference by its semantic anchors (seam API symbols, section topics, link
resolution), **not** its Markdown headings: headings are engine prose, not a
cross-repo contract, and dev builds follow the engine dev tip, so a heading
rename must never redden this suite (MS-0MVMNO29Z009SF6O).
