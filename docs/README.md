# Documentation

The documentation under `docs/` is split by **audience** into two independent
trees, so each reader can find what they need without wading through the
other audience's content (MS-0MUZK0OWJ000PQ2D).

- [`docs/game/`](game/) — **player-facing gameplay reference** for game
  designers, content authors and anyone reviewing what a player sees and
  reads: core rules, card catalogue, dimensions, storylines, UX/audio,
  tutorial/localisation and playtest scenarios.
- [`docs/dev/`](dev/) — **engineering, balance, PRD and evidence** docs for
  engineers, balance analysts and maintainers: balancing methodology and
  analysis APIs, guardrails, PRDs, Monte-Carlo baselines, generated balance
  evidence, the testing process and the card-packs runbook.

## The "where does X go?" rule

When adding a new document, place it by audience:

- Gameplay / player-facing content (rules, cards, storylines, UX, audio,
  tutorial, playtest scenarios) → `docs/game/`.
- Development / engineering / balance / process (methodology, PRDs,
  evidence, tooling, testing, runbooks) → `docs/dev/`.
- **Generated** artefacts (Mermaid graphs, JSON manifests/baselines, SVG
  graphs, rendered storylines, evidence tables) → the `<tree>/assets/`
  sub-directory of the audience tree that consumes them:
  - `docs/game/assets/` — storyline graph SVGs, screenshots, rendered
    storyline documents.
  - `docs/dev/assets/` — `.mmd` sources, JSON manifests/baselines,
    generated evidence JSON/MD pairs.

Do not create new files at `docs/` root and do not reintroduce a mixed
audience tree: a drift guard (`tests/main-street/docs-path-drift.test.ts`)
fails the build if the legacy flat tree under `docs/` is ever recreated.

## Tree index

### `docs/game/` — gameplay reference

| Document | Audience |
|---|---|
| [`core-rules-and-mechanics.md`](game/core-rules-and-mechanics.md) | Core rules, turn structure, end-of-turn sequence |
| [`card-catalog.md`](game/card-catalog.md) | Full card catalogue and per-family breakdown |
| [`card-dimensions.md`](game/card-dimensions.md) | Rendering dimensions and slot mappings |
| [`storylines.md`](game/storylines.md) | Storyline model, lifecycle, tooling and authoring |
| [`storylines/`](game/storylines/) | One document per storyline (diagram + event table) |
| [`storyline-incident-index.md`](game/storyline-incident-index.md) | Standalone incidents not in any storyline |
| [`content-design-and-progression.md`](game/content-design-and-progression.md) | Card inventory, economy and progression |
| [`specialization-skills.md`](game/specialization-skills.md) | Staff specialization skills |
| [`ux-visual-audio.md`](game/ux-visual-audio.md) | UX / visual / audio design notes |
| [`tutorial-localization.md`](game/tutorial-localization.md) | Tutorial and localisation editing |
| [`playtest-scenarios.md`](game/playtest-scenarios.md) | Curated playtest seeds |
| [`the-build-gdd.md`](game/the-build-gdd.md) | Historical game design document |

### `docs/dev/` — development, balance & evidence

| Document | Purpose |
|---|---|
| [`balancing-methodology.md`](dev/balancing-methodology.md) | Balancing algorithm and targets |
| [`balance-analysis-api.md`](dev/balance-analysis-api.md) | Balance analysis library API |
| [`balance-guardrail-recommendations.md`](dev/balance-guardrail-recommendations.md) | Drift-report decision tree and guardrails |
| [`further-balancing-recommendations.md`](dev/further-balancing-recommendations.md) | Further balancing recommendations |
| [`card-test-framework.md`](dev/card-test-framework.md) | Card test framework |
| [`ai-strategy.md`](dev/ai-strategy.md) | AI strategy overview |
| [`prd-*.md`](dev/prd-milestone-1.md) | Milestone and feature PRDs |
| [`monte-carlo-attribution-analysis.md`](dev/monte-carlo-attribution-analysis.md) | Monte-Carlo attribution analysis |
| [`monte-carlo-sample-results.md`](dev/monte-carlo-sample-results.md) | Sample Monte-Carlo results |
| [`testing.md`](dev/testing.md) | Testing process and browser-suite setup |
| [`card-packs-runbook.md`](dev/card-packs-runbook.md) | Card-pack authoring lifecycle runbook |
| [`analysis/`](dev/analysis/) | Balance analysis notes |
| [`*evidence.md`](dev/payback-rebalance-evidence.md) | Before/after balance evidence |
| [`assets/`](dev/assets/) | Generated baselines, manifests and evidence JSON/MD pairs |

## Related

- [`src/README.md`](../src/README.md) — source layout, CSV column reference and
  engine contracts.
- Root [`README.md`](../README.md) — repository overview and quickstart.
