# Card Pack Authoring Guide

## Overview

This directory contains the source trees for Main Street card packs. Each pack
is a self-contained directory that the card-pack builder turns into an
installable packs root under `<contentDir>/packs/`.

## Pack Layout

```
packs/
  manifest.json                         ← pack catalogue (one or more packs)
  <gameId>/
    <packId>/
      cards.csv                         ← CSV fragment (header + rows)
      assets/
        <card-name>.png                 ← pack art assets
```

The `manifest.json` declares each pack's id, gameId, version, core-engine
version constraint, and the paths to its CSV and assets. The builder upserts
each accepted entry into the output manifest by `(gameId, id)`.

## Building a Pack

Install the pack into the content directory by running:

```bash
npm run build:card-pack -- --input packs
```

This invokes `core/scripts/build-card-pack.mjs` and emits an installable
packs root under `build/card-packs/packs/`. Copy the contents of
`build/card-packs/packs/` into the launcher's `<contentDir>/packs/` to
install the pack.

## Production Packs

### main-street-residential-pack

- **Pack id:** `main-street-residential-pack`
- **gameId:** `main-street`
- **Version:** 1.0.0
- **Core engine version:** ^0.1.0
- **Cards:** 10 residential-themed cards (business, event, upgrade, staff,
  community-space) — see `cards.csv`
- **Assets:** `assets/<cardId>.png` (one per card)
- **Unlock key:** `dlc:main-street:main-street-residential-pack`
- **Purchase rule:** `main-street-residential-pack-purchase` (platform-action
  `dev` / `simulate-purchase`, resolved to the `simulated-purchase` verifier in
  `core/electron/action-rewards.json`)

The pack is gated on the launcher's unified content-unlock store
(`src/MainStreetContentUnlockGate.ts`). While locked its cards stay out of play;
a scoped simulated purchase — the `[ Purchase ]` control on the locked row in
the in-game Card Packs panel — unlocks it and its cards merge into the pool. The
purchase is **rule-scoped**, so it never collateral-unlocks another reward (for
example the itch.io golf follow).

Build and install it with:

```bash
npm run build:card-pack -- --input packs
# copy the emitted root into the launcher's content directory:
#   build/card-packs/packs/  ->  <contentDir>/packs/
```

## Constraints

- The CSV fragment **must** reuse the base `card-data.csv` header exactly (same
  columns, same order).
- Every card id must be unique across the base pool and all packs.
- The core merge rejects a mismatched header or a duplicate card id — the
  pack is refused whole.
- All art must be project-generated (CC0) and licence-clean.

## Adding a New Pack

1. Create a new `<gameId>/<packId>/` directory under `packs/`.
2. Add a `cards.csv` fragment with the same header as the base pool.
3. Add `assets/<name>.png` files for each card that needs bespoke art.
4. Register the pack in `manifest.json` with the required fields.
5. Build and install as above.
