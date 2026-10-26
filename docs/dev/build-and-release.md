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

## Two build policies

| Script | Engine behaviour | Purpose |
|--------|------------------|---------|
| `npm run build` | `engine:sync` **first**: advances `./core` to the latest remote head of the branch it tracks **and re-pins** `configs/engine-pin.json` to that commit, then type-checks and bundles | **Dev builds always compose the latest engine**, so behaviour is tested against current engine code; the pin keeps tracking it. |
| `npm run build:electron` | Same dev sync (pin included), Electron `vite` mode | Desktop dev builds. |
| `npm run build:release` | `engine:verify` **instead**: pins `./core` to exactly the SHA in `configs/engine-pin.json`, then type-checks and bundles | **Deterministic, reproducible release builds** — compile exactly the recorded engine commit. |

The standalone npm scripts are independently invocable:

```bash
npm run engine:sync     # dev: dirty-guard + `git submodule update --remote core` + re-pin
npm run engine:verify   # release: dirty-guard + pin check (lag vs bad pin) + exact checkout
```

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
4. **Offline fallback:** if the remote is unreachable, the build warns and
   continues with the current `./core` checkout instead of failing (dev work
   stays possible without network). Nothing moved, so the pin is left
   untouched.

After a sync the superproject records the new engine commit **and the matching
pin** as pending changes — commit them together (never one without the other).
A repo without a `configs/engine-pin.json` is never given one by `engine:sync`;
a repo is pinned once the pin file exists, and `engine:sync` maintains it from
then on.

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
| `npm test` (Vitest `unit` + `unit-cli`), and the pre-push/dev-push suite gate | the checkout present in `./core` — the preflight must accept it (pin, or a descendant of the pin) | preflight fail → run aborts |
| changed-scope gate (`npx vitest run <files>`) | the checkout present in `./core` — same preflight | preflight fail → run aborts |
| dev-push browser gate (`npx vitest run --project browser …`) | the checkout present in `./core` — same preflight | preflight fail → run aborts |
| `npm run build` / `build:electron` / the implement.py finish build step | engine dev head **after** `engine:sync` (the pin follows it) | `engine:sync` dirty guard |
| `npm run build:release` / `engine:verify` | **detached at the pin** after `engine:verify` | `engine:verify` pin match + dirty guard |
| freshly created worktree | whatever gitlink its branch recorded, **until** `engine:sync` runs | the preflight fails such a test run loudly, naming the composed SHA, the pin SHA and the exact remediation |

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

## Tests

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
