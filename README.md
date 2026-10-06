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
continue solo. A human seat's own collapse still ends the game as a loss. See
[docs/main-street/core-rules-and-mechanics.md](docs/main-street/core-rules-and-mechanics.md).

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
