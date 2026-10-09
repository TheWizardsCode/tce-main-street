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
  community-space)
- **Unlock key:** `dlc:main-street:main-street-residential-pack`

The pack is gated on the launcher's unified content-unlock store. While locked
its cards stay out of play; a scoped simulated purchase unlocks it and its
cards merge into the pool.

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
