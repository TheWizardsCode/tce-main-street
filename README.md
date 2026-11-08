# Main Street

Main Street is a single-game distribution of the
[Tableau Card Engine](https://github.com/TheWizardsCode/Tableau-Card-Engine):
an economic city builder played card by card, in which the player develops the
commercial hub of a city. This repository builds a launcher that contains
exactly one playable example game — **Main Street** — alongside the core-owned
**Gym** (always present in the engine's game selector).

A playable web build is published automatically to:

**https://thewizardscode.github.io/tce-main-street/**

See [DEPLOYMENT.md](DEPLOYMENT.md) for how the Pages site is built, released and
verified.

## Auto advance turn

When the player spends their last action point, a persisted **Auto advance
turn** setting (Settings panel toggle, default **off**) decides what happens:
with it **on**, the turn ends automatically once the spending action's
animations finish (the same flow as clicking **End Turn**); with it **off**
(the default), a dialog explains the out-of-actions state and offers to turn
the setting on. See
[docs/game/core-rules-and-mechanics.md](docs/game/core-rules-and-mechanics.md)
§6.0 and
[docs/game/ux-visual-audio.md](docs/game/ux-visual-audio.md).

## Loan payoff notification

When the final scheduled repayment retires a loan, Main Street announces the
**retired loan once** — after the closing animations and before the End of Turn
summary. The congratulation states that the seat is **debt free**, that the
weekly amount is **no longer deducted** and how much was repaid in total over
the term, and dismissing it continues into the summary (or straight into the
next week where that gate is skipped). It is **presentation-only** — no wallet,
activity-log, ledger, save or RNG change — suppressed in replay/headless runs
and shown only for the human seat in competitive play; a closing that ends the
run shows the game-over overlay instead. See
[docs/game/core-rules-and-mechanics.md](docs/game/core-rules-and-mechanics.md)
§5.1 and
[docs/game/ux-visual-audio.md](docs/game/ux-visual-audio.md).

## Closing a business

Closing a non-sold street card (Manage Card → **Close**) costs **1 action and
no coins** and removes it to the discard pile. It also **damages reputation**:
the player's reputation changes by `−(cardReputationPerTurn ×
closeReputationMultiplier)` (default multiplier **20**) and never drops below
0. Closing a reputation-positive card is therefore a penalty (a Café at +20 →
−400) while closing a nuisance card is a boost (the Pawn Shop at −10 → +200).
The change is undoable and shown in the activity log, and the AI factors the
reputation cost into its close decisions. See
[docs/game/core-rules-and-mechanics.md](docs/game/core-rules-and-mechanics.md).

## Challenges

Each run presents a seeded pool of **3 challenge goals** (13 templates across 6
categories) that grant a bonus score when satisfied. The catalogue includes the
economic challenge **Serial Seller** (`ch-serial-seller`) — "Sell 3 or more
businesses in a single game." — which counts only street sales via the Manage
Card → **Sell** dialog and shows its live progress (`0/3` → `3/3`) in the
challenge HUD tracker. Progress-capable challenges render `<current>/<target>`
on their row; the others render unchanged. Every challenge maps 1:1 to a
persistent Steam achievement. See
[docs/game/core-rules-and-mechanics.md](docs/game/core-rules-and-mechanics.md)
and `src/MainStreetChallenges.ts`.

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
collapsed and eliminated seats. A **third Stats column** graphs the run turn by
turn — profit per turn, and cash, businesses, staff and reputation at end of
turn — alongside the final `Cash at end of turn` figure and a
`[ View detailed stats ]` link on the Summary column, so players can see what
worked and learn from a failed run. See
[docs/game/core-rules-and-mechanics.md](docs/game/core-rules-and-mechanics.md)
and [docs/game/ux-visual-audio.md](docs/game/ux-visual-audio.md).

Competitive challenges are credited **per seat**: the shared challenge pool is
kept, but each completion is attributed to the seat that satisfied it
(`ActiveChallenge.completedBySeatId`) and the difficulty-scaled challenge
bonus goes only to that seat. The Game Over screen shows a per-seat challenge
breakdown, and the celebration, HUD and Steam achievements surface only the
human seat's completions. Single-player play is unchanged (run-global pool,
single-list summary). See
[docs/game/core-rules-and-mechanics.md](docs/game/core-rules-and-mechanics.md).

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

When that presentation finishes, a **Turn Summary** panel summarises the
completed round — **one owner-keyed row per seat** showing businesses owned,
income phases, ongoing expenses, the seat's incident and one-off deltas, net
coin/reputation/score change and its closing coins, reputation and score — and
the next shared day starts only when the player clicks **[ Next Turn ]**. Every
statement line (and each supplementary context row) explains itself on **hover**
(desktop) or **tap** (touch): the business-income lines name each business and
its contribution, the staff / community / business cost lines name each card and
its charge, and the Incident, One-off and Net lines spell out the effect and the
reconciliation formula (`income + expenses + incident + one-off = net`). The
one-off delta is stored only as a residual, so its tooltip shows that formula
rather than inventing per-source detail. Tooltips are presentation-only (no
state or RNG) and never block the panel's tabs or buttons. A 
round is one completed shared day: every non-eliminated seat has taken its
MarketPhase and the shared closing has run. **[ Bank Loan ]** is shown disabled
with its hint, behind the seam that will enable per-seat loans.

The engine's shared-day contract and seeded-replay determinism are unchanged —
this is presentation only. Reduced motion, replay and headless contexts skip
the animations and the panel, show the per-seat text and always advance the
day; a global fast-forward bound caps the total closing time so a large roster
cannot stall the game.

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

The first production pack is **Main Street Residential**
(`main-street-residential-pack`): ten residential-themed cards spanning the
business, event, upgrade, staff and community-space families. It is gated on the
launcher's **unified content-unlock store** (a
`dlc:main-street:main-street-residential-pack` unlock) rather than a Steam DLC
app id. For dev/QA there is a **simulated purchase** control on the locked pack
row in the Card Packs panel: it performs a rule-scoped purchase
(`main-street-residential-pack-purchase`), re-discovers the packs and makes the
pack enable-able — no storefront required.

### Browser distribution

The published web build carries the residential pack **inside the bundle**: no
manual `<contentDir>/packs/` copy step is involved.
[`src/MainStreetPackSources.ts`](src/MainStreetPackSources.ts) bakes the
committed [`packs/`](packs/README.md) tree into the build with Vite's
`import.meta.glob` (`?raw` for the manifest and CSVs, `?url` for the art), so
`npm run build` → `dist/` already contains the pack. Changing a bundled pack
requires a rebuild in this iteration.

Main Street reads pack content through a game-side **pack-source registry** (an
ordered list of `PackSource`s) wired into the core loader's existing injectable
`fetchManifest` / `fetchCsv` / `fetchAsset` transports, so the core renderer
loader (`core/src/ui/CardPackLoader.ts`) is unchanged. The bundled source is
registered first; a same-origin or remote source can be added **additively** by
registering it after the bundled one — see
[packs/README.md](packs/README.md#bundled-source-web-build) and the core
[Card Packs](core/docs/DEVELOPER.md#pack-sources-additive-game-side) section.

A **signed remote catalogue** is the shipped second source: build with
`VITE_REMOTE_PACK_URL` + `VITE_REMOTE_PACK_PUBLIC_KEY` (or the ordered
`VITE_REMOTE_PACK_SOURCES` list for several catalogues) and boot discovers the
remote packs alongside the bundled ones, verifying an Ed25519 signature against
the pinned public key first. Configuration is build-time, so changing a URL, a
key or the catalogue list requires a rebuild; the private signing key is held
by the operator and never ships. Only the configured host is requested and
every catalogue read (manifest and CSV) is timeout-bounded; any failure rejects
that source whole with one console warning while the game keeps playing the
bundled packs (the offline story — there is no client-side caching). The full
hosting/signing contract —
layout, canonical payload with a reproducible example, every verification
outcome, degradation semantics, the key-separation rule and the licence-clean
requirement — is in
[docs/dev/remote-pack-hosting.md](docs/dev/remote-pack-hosting.md).

A plain browser has no Electron `window.tce.contentUnlocks` bridge, so the
content-unlock read is backed by
[`src/MainStreetBrowserContentUnlockClient.ts`](src/MainStreetBrowserContentUnlockClient.ts),
a total `localStorage`-backed `ContentUnlockClient` (key
`tce-main-street-content-unlocks`). It preserves the full lock → purchase →
enable flow and survives a page reload; when the Electron bridge *is* present it
keeps precedence, so the launcher's unified store remains authoritative.

The pack **authoring** source lives under [`packs/`](packs/README.md). Build and
install it into a launcher's content directory with
`npm run build:card-pack -- --input packs`, copying the emitted root under
`<contentDir>/packs/` (the Electron distribution path; the browser build uses
the bundled source described above).

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

**Tests verify the composed engine.** A fresh worktree checks out whatever
gitlink its branch recorded, which can silently lag the engine pin in
`configs/engine-pin.json`. Every Vitest run therefore passes an engine-checkout
preflight (`npm run engine:check`) that fails loudly — naming the composed SHA,
the pin SHA and the exact remediation — when `./core` is not the pinned engine
or a descendant of it; run `npm run engine:sync` in a fresh worktree before
testing (see [docs/dev/build-and-release.md](docs/dev/build-and-release.md)).

## Install, test and build

```bash
npm ci          # install the exact locked dependency tree
npm test        # unit suite (vitest run --project unit)
npm run build   # engine:sync (latest engine dev) + type-check + production bundle
```

Builds follow the dev/release split — dev builds auto-sync the `./core`
engine submodule to the latest engine dev head **and re-pin
`configs/engine-pin.json` to it**, while `npm run build:release`
compiles exactly the SHA pinned in `configs/engine-pin.json`. See
[docs/dev/build-and-release.md](docs/dev/build-and-release.md).

See [docs/dev/testing.md](docs/dev/testing.md) for the browser (headless Chromium)
suite and the shared-helper import convention (`@core-tests/*` aliases).

Run the game locally in watch mode:

```bash
npm run dev     # soft engine sync (never blocks on a dirty ./core), then Vite on http://localhost:3000
```

`npm run dev` runs `engine:dev-sync` first: a **clean** `./core` is advanced to
the engine `dev` tip (and the pin re-staged with the gitlink), while a **dirty**
`./core` is skipped with a warning so your engine working tree is served as-is.
Builds use the strict `engine:sync`; see
[docs/dev/build-and-release.md](docs/dev/build-and-release.md#dev-start-engine-dev-sync--soft-sync-never-blocks).

The dev server shares the host with sibling repos, agent worktrees and test
suites, so it can be killed by host memory/swap pressure mid-session (the
browser shows `[vite] server connection lost` and `ERR_CONNECTION_REFUSED` for
every card asset). Run the read-only check before starting a long session
(`scripts/hygiene_check.sh`), keep at most one `vite --host` server per host,
and follow the host-pressure hygiene runbook in
[docs/dev/testing.md](docs/dev/testing.md#host-pressure-hygiene-runbook-ms-0mvs0fnlh003vbmw)
for pre-flight checks, worktree hygiene and the restart/reclamation steps.

The documentation has a browsable, local-only site with sidebar navigation
and rendered Mermaid diagrams (navigation is generated from the `docs/`
tree, so new documents appear automatically):

```bash
npm run docs         # VitePress dev server (hot reload)
npm run docs:build   # static site into docs/.vitepress/dist/ (git-ignored)
npm run docs:preview # serve the built site
```

See [docs/README.md](docs/README.md) and the site's landing page
(`docs/index.md`) for details. The docs toolchain is a dev dependency only —
it never enters the game bundle — and there is no CI publishing.

The dev server's file watcher excludes the `.worklog/` worktree checkouts and
the dev-output trees (`data/`, `tmp/`, `results/`, `dist/`) via
`server.watch.ignored` (see `vite.config.ts`) — a recursive watch into
`.worklog/worktrees/**` would exhaust `fs.inotify.max_user_watches` (ENOSPC)
and crash the dev server (MS-0MV8M9IAF000KPNY).

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
| `configs/engine-pin.json` | Engine pin `{"sha": "…"}` — created by the release process, then **tracked to the engine `dev` tip by every dev `engine:sync`** (the pin and the `core` gitlink travel together). |
| `docs/` | Design, balance and localization documentation — including `docs/game/tutorial-localization.md`, the guide for editing the spreadsheet-editable tutorial copy (`src/i18n/tutorial-en.csv`). Served as a **local VitePress site** via `npm run docs` (see [docs/index.md](docs/index.md)). |
| `.github/workflows/deploy.yml` | GitHub Pages build-and-deploy workflow. |

The `./core` submodule pins a specific engine commit; **dev builds advance it
automatically** (`engine:sync`, tracked on engine `dev`) **and re-pin
`configs/engine-pin.json` to the advanced commit in the same step**, and
release builds (`build:release`) compile exactly the SHA in
`configs/engine-pin.json`. The policy: **the pin tracks the engine `dev` tip**;
a lag is a genuine failure and the pin and the gitlink travel together
(mechanical re-pin delivered by engine change `CG-0MVO268500071BPI`; before
that fix the pin was written by hand at release time only). Every
test run states which engine it composed via the engine-checkout preflight
(`npm run engine:check`) and fails loudly when the checkout is not the pin or
a descendant of it. See[docs/dev/build-and-release.md](docs/dev/build-and-release.md) for the policy; never edit a dev build into a release silently — use `build:release` for pinned, reproducible output.
