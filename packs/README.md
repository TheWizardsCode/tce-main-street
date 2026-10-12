# Card Pack Authoring Guide

## Overview

This directory contains the source trees for Main Street card packs. Each pack
is a self-contained directory that the card-pack builder turns into an
installable packs root under `<contentDir>/packs/` **and** that the web build
bundles directly (see
[Bundled source (web build)](#bundled-source-web-build)).

## Bundled source (web build)

The committed `packs/` tree is more than an authoring source: the **same tree is
baked into the web build at build time**. `src/MainStreetPackSources.ts` reads
it with Vite's `import.meta.glob` (`?raw` for `manifest.json` and each pack's
`cards.csv`, `?url` for the asset binaries) and exposes it as the first entry in
Main Street's pack-source registry, so the published browser build discovers
the residential pack with **no manual `<contentDir>/packs/` copy step**.

- **A bundled-pack change requires a rebuild in this iteration.** Editing
  anything under `packs/**` (the manifest, a `cards.csv`, or an asset) changes
  what is bundled only after `npm run build`; a running bundle is not reloaded
  and there is no runtime content-directory install in the browser
  distribution.
- **The Electron content-directory path is separate and unchanged.** The
  `npm run build:card-pack` → `<contentDir>/packs/` install described below is
  still how a pack is delivered to the desktop launcher. The browser build uses
  the bundled source instead because it has no content directory.
- **Sources are additive.** The bundled source is registered first; a
  same-origin (`<base>/packs/…`) or remote source can be added by implementing
  `PackSource` and registering it after the bundled one — the core loader is
  unchanged. See the core repo's [Card
  Packs](../core/docs/DEVELOPER.md#pack-sources-additive-game-side) section.

## Pack Layout

```
packs/
  manifest.json                         ← pack catalogue (one or more packs)
  <gameId>/
    <packId>/
      cards.csv                         ← CSV fragment (header + rows)
      assets/
        <cardId>.png                    ← pack art (asset stem = card id, Option A)
```

The `manifest.json` declares each pack's id, gameId, version, core-engine
version constraint, and the paths to its CSV and assets. The builder upserts
each accepted entry into the output manifest by `(gameId, id)`.

## Pack Art Resolution

A pack's declared `assets/<cardId>.png` are the **only** art a pack needs. The
generated base art map (`src/card-art-map.json`) is **base-pool only** and is
not a pack dependency.

At boot the core loader (`core/src/ui/CardPackLoader.ts`) reads each declared
asset's bytes through the environment-injected `fetchAsset` transport (default
`fetch` + `arrayBuffer`) and inlines them as `data:<media>;base64,…` URIs keyed
by card id (`LoadedCardPack.assetDataUris`). Main Street registers those URIs in
`src/MainStreetCardPackArt.ts` before any card texture is generated, so
`MainStreetCardArt.getCardArtDataUriForCard(cardId, cardName)` resolves a pack
card from its own asset and falls back to the base map and then `Fallback`.

- **Option A — asset stem = card id.** `assets/biz-ms-residential-solar.png`
  supplies the card `biz-ms-residential-solar`. No CSV or manifest schema
  change is required; the mapping is derived from the declared `assets` list.
- **Environment-agnostic.** The loader consumes the injected transport, so the
  same path works for Electron `tce-packs://` URLs and for the bundled browser
  asset URLs supplied by `MS-0MV1O7EGG004MWGD` (no scheme-specific branching).
- **Graceful degradation.** A missing, unreadable or malformed asset is
  reported structurally and omitted; the card degrades to the base map and then
  `Fallback` art with a logged warning — never a crash or a blank face.
- **Core seam.** The inlining seam is the cross-repo core feature
  `CG-0MV590RLL0026M7G` (`CardPackLoaderOptions.fetchAsset` +
  `LoadedCardPack.assetDataUris`).

## Building a Pack

Install the pack into the content directory by running:

```bash
npm run build:card-pack -- --input packs
```

This invokes `core/scripts/build-card-pack.mjs` and emits an installable
packs root under `build/card-packs/packs/`. Copy the contents of
`build/card-packs/packs/` into the launcher's `<contentDir>/packs/` to
install the pack.

`build:card-pack` first runs `npm run generate:pack-assets`, which emits each
pack's `assets/<cardId>.png` deterministically (256×256 PNG) from the committed
`src/sprites/<Name>_1024_x_1024.png` sources. To regenerate by hand after
changing a pack's `cards.csv` or `src/sprites/` sources:

```bash
npm run generate:pack-assets                          # pack assets (from src/sprites)
node src/scripts/generate-main-street-card-art.mjs     # base art map (base pool only)
node src/scripts/generate-main-street-card-svgs.mjs    # static SVG fixtures (if applicable)
```

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
- Pack art lives in `assets/<cardId>.png` (the asset stem is the card id) and
  must be declared in the manifest's `assets` list.
- All art must be project-generated (CC0) and licence-clean.

## Adding a New Pack

1. Create a new `<gameId>/<packId>/` directory under `packs/`.
2. Add a `cards.csv` fragment with the same header as the base pool.
3. Add `assets/<cardId>.png` files for each card that needs bespoke art
   (the asset filename stem must equal the card id).
4. Register the pack in `manifest.json` with the required fields.
5. Build and install as above.
