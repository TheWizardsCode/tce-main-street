# Main Street: Card Diagrams

> **Data source of truth:** `src/card-data.csv` — every diagram below is
> generated from the typed card model that loads this CSV.
> **Generated artefacts:** the `.mmd` files under `docs/dev/assets/` are
> generated and must **never be hand-edited**; regenerate them with
> `npm run docs:diagrams`. A drift guard (`--check`) fails when a committed
> artefact differs from a fresh render.

The card model carries relationship data that is difficult to hold in your
head — synergy memberships, staff eligibility, upgrade families and
community-space buffs. `docs:diagrams` renders that data as deterministic
Mermaid flowcharts so the relationships can be reviewed, diffed and
drift-checked like code.

Mermaid remains the source of truth: the committed `.mmd` files are the
canonical artefacts, and rendering them to SVG/PNG is a separate concern
(see the storyline SVG renderer for the existing precedent).

## Regenerating the diagrams

All scripts run under `vite-node` because the card model imports
`src/card-data.csv` through Vite's `?raw` query.

| Command | Purpose |
|---------|---------|
| `npm run docs:diagrams` | Regenerate every registered diagram (default `--diagram all`) into `docs/dev/assets/`. |
| `npm run docs:diagrams -- --diagram synergies` | Regenerate only the card-synergy diagram. |
| `npm run docs:diagrams -- --diagram staff` | Regenerate only the staff relationship diagram. |
| `npm run docs:diagrams -- --diagram upgrades` | Regenerate only the upgrade chain diagram. |
| `npm run docs:diagrams -- --diagram community-spaces` | Regenerate only the community-space relationship diagram. |
| `npm run docs:diagrams -- --format json` | Emit the node/edge manifest as JSON (`docs/dev/assets/card-diagrams.json`) instead of Mermaid — on demand, not committed. |
| `npm run docs:diagrams -- --check` | Drift guard: exit `0` when every committed artefact matches a fresh render, exit `1` on drift or a missing artefact (stderr prints the regenerate command). |
| `npm run docs:diagrams -- --diagram staff --out /tmp/staff.mmd` | Write one diagram to an explicit path (single-diagram selection only). |

`--diagram` accepts `all` (default), `synergies`, `staff`, `upgrades` and
`community-spaces`. `--format` accepts `mermaid` (default) and `json`.

## The diagrams

### Card synergies — `docs/dev/assets/card-synergies.mmd`

Shows every business (31) and community-space (8) card as a node, all six
synergy types (Food, Culture, Service, Commerce, Entertainment, Health) as
circular nodes, and one edge per card↔synergy membership labelled with the
synergy type.

**How to read it:** two cards whose edges meet at the same synergy node are
adjacency-compatible and earn the synergy bonus when placed next to each
other. Cards with two outgoing edges bridge two clusters — for example
`biz-cafe` connects Food and Culture, while `cs-public-art` connects Culture
and Entertainment.

### Community-space relationships — `docs/dev/assets/community-space-relationships.mmd`

Shows each of the eight community-space cards with its synergy types, plus
each community-space upgrade reachable through the card's `targetBusiness`.
Upgrade nodes are labelled with the upgrade's `newDisplayName` and the edge
records the required level (the upgrade gate). Node detail lines record the
card's ongoing running cost and reputation per turn, and the upgrade's cost
and buffs where set.

**How to read it:** a community space's outgoing synergy edges describe which
neighbours it pairs with; its outgoing upgrade edge shows what it becomes
(and at which level) once upgraded. Community Shelter and Public Art have no
upgrade, so they show synergy edges only.

### Staff relationships — `docs/dev/assets/staff-relationships.mmd`

Shows every staff card (26) as a node, with one edge to each synergy type and
each named business it may serve. Eligibility is resolved exclusively through
the card model helpers (`getAllowedBusinessTypesForStaff` /
`staffMatchesBusiness`) — the diagram never re-parses raw CSV fields.
Specialists therefore show a small, targeted set (for example
`staff-health-safety` serves Health only, and `staff-chef` serves Cafe, Diner
and Delicatessen plus the Food synergy), while generalists fan out to every
synergy type.

The specialisation-skill catalogue (`src/MainStreetStaffSkills.ts`) appears
alongside the staff: four category nodes (`income-boost`,
`reputation-boost`, `cost-reduction`, `incident-mitigation`) with an edge to
every catalogue skill in that category, labelled with the skill's effect id.

**How to read it:** follow a staff node's edges to learn where it can be
employed; follow a category node's edges to enumerate the skills it can roll.

### Upgrade chains — `docs/dev/assets/upgrade-chains.mmd`

Shows each upgradeable business or community space as a chain root, every
level-0 upgrade branching directly from that root, and every multi-level
upgrade succeeding its level-1 step. Upgrade nodes are labelled with their
`newDisplayName`; the edge records the required level, and the node detail
line records cost, income bonus and reputation bonus where set.

**How to read it:** a root with several outgoing edges offers a choice of
level-0 branches (for example Bakery → Patisserie or Bread Factory). A
level-1 upgrade hangs off its level-0 parent rather than the root, so the
level-2 chain is visible: Bread Factory → Grand Bakehouse, Fast Food →
Restaurant, IMAX Theater → Multiplex, Resort Spa → Luxury Retreat.

## Reading the node shapes

The same shapes are used in every diagram:

| Shape | Meaning |
|-------|---------|
| Rounded rectangle (`("…")`) | A business or community-space card. |
| Circle (`(("…")`) | A synergy type. |
| Rectangle (`["…"]`) | An upgrade, staff member, specialisation skill or skill category. |

Each node is labelled with its display name and its stable card id, followed
by an optional detail line (ongoing costs, income/reputation buffs, max
level). Edge labels name the relationship — the synergy type, the upgrade's
new display name and level, or the skill effect.

## Determinism and drift

The generator is deterministic by construction:

- Nodes are sorted by id and edges by `(from, to, label)`.
- There is no RNG, timestamp or wall-clock input, so two runs over the same
  CSV produce byte-identical files.
- The generator is **dev tooling only** — it adds no runtime dependency and
  nothing it produces enters the game bundle.

Run the drift guard in CI (or before committing a CSV change) with
`npm run docs:diagrams -- --check`; it exits `1` and prints a regenerate
command when a committed artefact no longer matches the CSV.

## Related documents

- [`src/card-data.csv`](../../src/card-data.csv) — the data source for every diagram.
- [`docs/game/card-catalog.md`](./card-catalog.md) — the full card catalogue (families, fields and rationales).
- [`docs/game/storylines.md`](./storylines.md) — the storyline graph tooling and authoring guide (`npm run storylines:graph`).
- [`src/README.md`](../../src/README.md) — CSV column reference and engine contracts.
- [`docs/dev/assets/`](../dev/assets/) — the committed generated artefacts.
- [`src/scripts/card-diagrams.ts`](../../src/scripts/card-diagrams.ts) — the deterministic node/edge builders and renderers.
