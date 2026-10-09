# Main Street

Main Street is a single-game distribution of the
[Tableau Card Engine](https://github.com/TheWizardsCode/Tableau-Card-Engine):
a small-business engine-builder played card by card on a shared high street.
This repository builds a launcher that contains exactly one playable example
game — **Main Street** — alongside the core-owned **Gym** (always present in
the engine's game selector).

A playable web build is published automatically to:

**https://thewizardscode.github.io/tce-main-street/**

See [DEPLOYMENT.md](DEPLOYMENT.md) for how the Pages site is built, released and
verified.

## Competitive ownership

In human-vs-AI competitive play the shared street is owner-tagged. A seat may
only **sell, close or upgrade a business it owns**; clicking an opponent-owned
slot blocks the **Manage Card** dialog with an ownership-specific message. The
rule is enforced in one legality layer (`canActiveSeatActOnSlot`) so the UI, AI
and headless paths cannot diverge, and single-player play is unaffected.

Competitive game-over is evaluated **per seat** from each seat's own wallet. A
failing AI opponent is **eliminated** — removed from turn rotation with its
businesses closed — and the surviving seats play on; when the last AI is
eliminated the human wins by **last standing**, with an explicit option to
continue solo. A human seat's own collapse still ends the game as a loss. The
Game Over screen states the reason the run ended in plain language and shows
every seat's final coins, reputation and score side by side, flagging bankrupt,
collapsed and eliminated seats. See
[docs/main-street/core-rules-and-mechanics.md](docs/main-street/core-rules-and-mechanics.md).

### Competitive end-of-turn

Once every seat has taken its MarketPhase the shared day resolves a single
closing — income → incident → end check — exactly as in single-player. In
competitive mode the closing is then **presented per seat**: every
non-eliminated seat, in seat order, replays the full phased income
choreography (base → synergy → reputation → events → upcoming → grid-to-HUD
coin collection) with that seat's own authoritative income. The closing text
reports each seat's own gain (for example `Player 2: +7 coins`) rather than
the shared host total, which can differ from any seat's actual income.
Eliminated seats are skipped.

The engine's shared-day contract and seeded-replay determinism are unchanged —
this is presentation only. Reduced motion, replay and headless contexts skip
the animations, show the per-seat text and always advance the day; a global
fast-forward bound caps the total closing time so a large roster cannot stall
the game.

## Card packs (DLC)

Main Street supports **card packs** — extra cards delivered as DLC and merged
into the card pool at startup, without rebuilding the game or the launcher. A
pack is a manifest plus a CSV fragment in Main Street's `card-data.csv`
schema (and optional art), installed under the launcher's content directory at
`<contentDir>/packs/main-street/<packId>/`. Pack rows are merged into the base
pool through the engine's deterministic
[`mergeCardPackCsv`](core/src/core-engine/CardPackMerge.ts) seam; a fragment
must reuse the base header exactly, and a duplicate card id or mismatched
header rejects that pack **whole**.

Installed packs are listed in the in-game **Card Packs** panel (top-right HUD
button). Entitled packs are enabled by default and can be toggled; a
present-but-unowned pack is listed **locked** with a reason and its cards stay
out of play. The enabled set is remembered for new games, and saves record the
active pack set plus the merged checksum, so a load restores the same pool and
degrades gracefully (a warning, base content) when a pack is missing. The game
refuses to resume only when a live card instance needs a template from a
missing/disabled pack.

Authoring, building, installing and gating a pack — with the reference pack as
a worked example — is documented in the core repo's
[Card Packs](core/docs/DEVELOPER.md#card-packs) section (which links the
step-by-step `docs/dev/card-packs-runbook.md`).

## Prerequisites

- **Node.js 20** and npm (the CI workflow pins Node 20).
- **Git**, with the `./core` submodule initialised. The engine toolchain
  (config-driven game discovery, core path aliases) is imported from `./core`.

Clone with the submodule in one step:

```bash
git clone --recurse-submodules https://github.com/TheWizardsCode/tce-main-street.git
cd tce-main-street
```

If you cloned without `--recurse-submodules`, initialise it afterwards:

```bash
git submodule update --init --recursive
```

## Install, test and build

```bash
npm ci          # install the exact locked dependency tree
npm test        # unit suite (vitest run --project unit)
npm run build   # type-check (tsc --noEmit) + production bundle into dist/
```

Run the game locally in watch mode:

```bash
npm run dev     # Vite dev server on http://localhost:3000
```

Serve the production bundle exactly as GitHub Pages would (see
[DEPLOYMENT.md](DEPLOYMENT.md) for the Pages base path):

```bash
npm run build
npm run preview   # http://localhost:4173/tce-main-street/
```

## Project layout

| Path | Purpose |
|------|---------|
| `main.ts` | Application entry point. |
| `index.html` | HTML shell and the client-side 404 redirect guard. |
| `src/` | Main Street game code (engine, cards, difficulty presets, UI). |
| `tests/` | Vitest unit and browser suites, including `tests/deploy/` build/deploy contract tests. |
| `public/assets/` | Card art, audio and other static assets bundled into the build. |
| `configs/game.json` | The single-game preset: the core-owned Gym plus Main Street. |
| `core/` | Git submodule pointing at the Tableau Card Engine (shared engine + toolchain). |
| `docs/` | Design and balance documentation. |
| `.github/workflows/deploy.yml` | GitHub Pages build-and-deploy workflow. |

The `./core` submodule is pinned to a specific engine commit; update it with
`git submodule update --remote core` only as part of a deliberate engine bump.
