# Main Street: Storylines

> **Canonical reference for the Main Street storyline (dual-choice incident
> chain) mechanic.** If this document and the code disagree, the code wins —
> and the discrepancy should be fixed by updating this document and the
> [doc-drift test](../../tests/main-street/storylines-doc-drift.test.ts).

---

## 1. Concepts

A **storyline** is a named, multi-step incident arc. A storyline incident
presents the player with an ordered list of **options**; each option decides
whether the incident's own effect applies and which card (if any) is queued
next. Storylines are how the game turns single incidents into recurring
threads the player can steer.

Key terms:

| Term | Meaning |
|------|---------|
| **Storyline id / title** | A stable grouping key (`storyline-tax`) and a display name (`Tax Troubles`). Descriptive metadata — it groups cards into an arc and drives the journal, but does **not** by itself make a card a choice. |
| **Choice card** | An incident that pauses resolution and asks the player to pick an option. Marked by `hasChoices=true`, or by a registered option list. |
| **Option** | `{ label, successorIds, effectPolicy }` plus optional runtime callbacks `condition` / `successorResolver` (see §2.1). `effectPolicy` is `apply` (run the incident's effect) or `skip` (ignore it — CSV content always `apply`). `successorIds` is the ordered candidate set of cards queued next; empty means the chain ends. When an option is chosen, one candidate is drawn uniformly at random at resolution time. |
| **Successor / chain card** | The card pushed onto the incident deck when an option is chosen. |
| **Cycle** | A chain that returns to an earlier card. Cycles are a **first-class shape** (see §6). |
| **Pending choice** | `state.pendingEventChoice` — the drawn choice card awaiting a decision; the end-of-turn sequence is deferred until it resolves. |

The shipped game defines five storylines:

| Storyline id | Title | Choice cards |
|--------------|-------|--------------|
| `storyline-tax` | Tax Troubles | `evt-tax`, `evt-tax-error`, `evt-tax-inquiry` |
| `storyline-health` | Public Health Crisis | `evt-flu-outbreak` (→ `evt-pandemic`) |
| `storyline-economy` | Economic Downturn | `evt-recession` (→ `evt-depression` or `evt-general-strike`) |
| `storyline-labor` | Labour Unrest | `evt-strike-service` (→ `evt-general-strike`) |
| `storyline-restaurant` | Restaurant Renaissance | `evt-popular-menu` (→ `evt-farm-table`) |

### Player agency

Storylines are surfaced to the player through pure helpers in
[`src/MainStreetStorylineUi.ts`](../../src/MainStreetStorylineUi.ts) (unit-tested
without a browser):

- **Named dialog** — the choice dialog title is the storyline name
  (`choiceDialogTitle`, fallback: the card name) with the specific incident as
  a subtitle (`choiceDialogSubtitle`). The dialog appears instantly, so it is
  reduced-motion safe.
- **Outcome feedback** — resolving a choice writes a narrative “story update”
  line to the activity log, tied to the storyline (`storyUpdateLine`).
- **Journal & choice clarity** — a **Journal** HUD action opens an overlay
  listing past storyline choices and outcomes, most recent first, with an empty
  state before any choice (`buildJournal`/`journalIsEmpty` in
  [`src/MainStreetStorylineJournal.ts`](../../src/MainStreetStorylineJournal.ts)).
  The choice dialog also shows explanatory option labels describing the
  apply-vs-skip semantics without revealing the escalation card
  (`choiceClarityLabels`).

---

## 2. Data model and CSV columns

Choice/storyline data lives on `EventCard`
(`src/MainStreetCardsTypes.ts`) and is authored in
[`src/card-data.csv`](../../src/card-data.csv). Five optional columns drive the
mechanic (all default to empty = legacy behaviour):

| Column | Type | Description |
|--------|------|-------------|
| `hasChoices` | boolean (`true`/empty) | When `true`, the incident pauses and asks for an option. Only the literal string `true` (case-insensitive) is accepted. |
| `acceptNextCardId` | string | Card pushed when the **Accept** option (option 0, effect policy `apply`) is chosen. Empty ends the chain. |
| `rejectNextCardId` | string | Card pushed when the **Reject** option (option 1, effect policy `skip`) is chosen. Empty ends the chain. |
| `storylineId` | string | Storyline grouping key. Descriptive (journal). |
| `storylineTitle` | string | Storyline display name; falls back to the card name when empty. |

These are appended to the shared header, so `src/README.md`'s
[CSV column reference](../../src/README.md#csv-column-reference) lists them too.

### The generalised option model

Internally the legacy fields compile to an ordered option list
(`StorylineOption`):

```ts
// hasChoices=true + accept/reject links compile to exactly:
[
  { label: 'Accept', successorId: acceptNextCardId, effectPolicy: 'apply' },
  { label: 'Reject', successorId: rejectNextCardId, effectPolicy: 'skip' },
]
```

Plain (non-choice) cards compile to an empty list. The compilation is
**byte-for-byte behaviour-preserving**: a legacy card resolves exactly as it did
before the option model existed (pinned by the C1 regression harness and the
legacy-equivalence tests).

Multi-way storylines (>2 options) can be declared programmatically via
`registerStorylineOptions(eventId, options)` in
[`src/MainStreetStoryline.ts`](../../src/MainStreetStoryline.ts); explicit
options take precedence over the legacy compilation. Authoring new options via
CSV keeps to the two-way Accept/Reject shape today.

### The `options` CSV column (arbitrary multi-outcome encoding)

New CSV-authored choice nodes use a single `options` column instead of the
legacy `hasChoices`/`acceptNextCardId`/`rejectNextCardId` trio. The encoding is:

```text
label|cardA,cardB;label2|cardC
```

| Token | Meaning |
|-------|---------|
| `;` | Separates one option from the next. |
| `|` | Separates an option's label from its candidate successor card ids. |
| `,` | Separates the candidate card ids within one option. |

The value is parsed deterministically with surrounding whitespace trimmed at
every level (labels, separators and candidate ids):

- **Blank / absent** — the card is **not** a choice node (equivalent to
  `hasChoices` empty).
- **`label|`** (an empty candidate list) — a **terminal** option: choosing it
  ends the chain. This is a valid encoding, not an error.
- **`label|cardA,cardB`** — the option carries an ordered candidate set of
  possible successors. When the option is chosen, one candidate is selected
  (the uniform random draw lands in F3, `MS-0MV8KQL820077BOS`).
- **Non-empty but no valid option** (e.g. `;;`, or a segment missing `|`) —
  rejected with an error rather than silently ignored.

CSV-authored options always compile with `effectPolicy: 'apply'` (producer
Q4=B): the incident's own effect applies whichever option the player picks.
`skip` remains available only through the programmatic
`registerStorylineOptions` seam. `hasChoices` is **derived** from a non-empty
option list, so an `options`-authored row intercepts resolution exactly like a
legacy choice card.

```ts
// `options` cell: "Negotiate|evt-nat-a,evt-nat-b;Walk away|;Escalate|evt-nat-c"
compileStorylineFromEvent(card).compiledOptions;
// → [
//   { label: 'Negotiate', successorIds: ['evt-nat-a', 'evt-nat-b'], effectPolicy: 'apply' },
//   { label: 'Walk away', successorIds: [], effectPolicy: 'apply' },
//   { label: 'Escalate', successorIds: ['evt-nat-c'], effectPolicy: 'apply' },
// ]
```

The parser is exposed as `parseStorylineOptionsEncoding(encoding)` in
[`src/MainStreetStoryline.ts`](../../src/MainStreetStoryline.ts) and the
encoding is validated by `npm run validate:storylines`.

### 2.1 Callback escape hatch

Some narrative logic cannot be expressed with field/op/value predicates
(derived values, card-history checks, compound predicates). Each
`StorylineOption` therefore accepts two optional **runtime-only** callbacks:

```ts
interface StorylineOption {
  // …label, successorId, effectPolicy…
  readonly condition?: (state: MainStreetState) => boolean;
  readonly successorResolver?: (state: MainStreetState) => string | null | undefined;
}
```

- **`condition` — evaluated at draw time.** When the option list is compiled
  (the player is presented with the choice), each option's `condition` is
  called against the live state. Returning `false` omits the option from the
  presented list; `true` (or no condition) keeps it. Once the list is
  presented it is **frozen**: mutating state between draw and resolution does
  not re-evaluate conditions.
- **`successorResolver` — evaluated at resolution time.** When the chosen
  option has a `successorResolver`, it is invoked as the option resolves (after
  `effectPolicy` is applied) and its return value replaces `option.successorId`
  as the pushed successor. Returning `null` or `undefined` ends the chain.
  When absent, the declarative `successorId` is used unchanged.

**Contract (read-only, pure).** Both callbacks are typed as pure functions
over `MainStreetState`. They must not mutate state or perform side effects;
mutating state inside a callback is undefined behaviour. The callback type is a
thin abstraction over a state shape that the generic core engine consumes
(`@story-line`), so no Main Street internals are baked into the callback
signature.

**Not serialisable.** Callbacks are registered programmatically via
`registerStorylineOptions`; they are never authored in CSV or the
manifest/schema, and are invisible to the validator and graph export. A
callback-equipped option with no `condition` behaves exactly like a legacy
option (backward compatible).

```ts
import { registerStorylineOptions } from './MainStreetStoryline';

registerStorylineOptions('evt-nationalise', [
  {
    label: 'Nationalise',
    successorId: 'evt-nationalise-fallout',
    effectPolicy: 'apply',
    // Only offered when the player previously took the state-led path.
    condition: (s) => s.resourceBank.coins > 1000 || s.turn > 12,
    // Resolution depends on runtime state that cannot be captured declaratively.
    successorResolver: (s) =>
      s.resourceBank.reputation > 50 ? 'evt-nationalise-win' : null,
  },
  { label: 'Decline', successorId: null, effectPolicy: 'skip' },
]);
```

The AI path needs no option-list special-casing: `decideEventChoice` selects
from the presented option list, which the draw-time compile has already
filtered by `condition` **and** affordability (`cost`), so the AI never sees an
option the player would not have been offered. It does fold the presented
options' `cost` / `extraEffect` deltas into its value (§4).

---

## 3. Resolution lifecycle

1. **Draw** — `resolveIncident` (`src/MainStreetEngineTurnClosing.ts`) draws
   the next incident. If the card presents a choice
   (`eventHasStoryline(event)` — `hasChoices` or registered options), the effect
   is **deferred**: the card becomes `state.pendingEventChoice`
   (`{ event, chosenOption: null, resolved: false }`), nothing is applied, and
   `resolveIncident` returns `null`.
2. **Pause** — `processEndOfTurn` sees an unresolved pending choice and returns
   `TurnResult.choicePending = true` before the income phase/EndCheck, so the
   UI can show the option dialog.
3. **Resolve** — `resolveEventOption(state, optionIndex)` looks up the option,
   applies or skips the incident's effect per `effectPolicy`, pushes the
   successor card (if any) onto the incident deck, records an `event-choice`
   transcript entry, and marks the pending choice resolved.
   `resolveEventChoice(state, 'accept' | 'reject')` is the backward-compatible
   wrapper over option index 0/1.
4. **Finish** — `finishDeferredEndOfTurn` consumes the resolved pending choice
   (clears it) and runs the remaining closing phases (EndCheck → next week).

```
resolveIncident ──(choice card)──▶ pendingEventChoice ──▶ processEndOfTurn pauses
        │                                                       │
        └──(plain card)──▶ apply effect, continue               ▼
                                             resolveEventChoice / resolveEventOption
                                                         │
                                            apply/skip + push successor
                                                         │
                                            finishDeferredEndOfTurn
```

**Deterministic successor draw.** When an option is chosen, its successor is
drawn at resolution time with **exactly one** seeded `state.rng()` call over the
option's ordered candidate set (uniform; replay with the same seed yields the
same branch). Precedence: `successorResolver` callback (if present) over the
random draw over an empty candidate set ending the chain (`resolveStorylineOption`, `MS-0MV8KQL820077BOS` / `MS-0MUZKA9CJ000N144`).

**Undo/redo.** `resolveEventChoiceCommand` (from `MainStreetCommands.ts`) is a
snapshot-based command: undo restores the unresolved pending state (escalation
removed, resources restored), redo re-applies.

**Save/load.** `pendingEventChoice` is serialised (`MainStreetStateSerialize.ts`)
so an unresolved choice survives a save. Legacy saves without the field load
with `pendingEventChoice = null`. `chosenOption` is `string | null` — the
chosen option's **label** is the stable token (`'Accept'`, `'Reject'`, or a
generalised label; the legacy lowercase `'accept'`/`'reject'` tokens were
removed in `MS-0MV8KQL820077BOS`).

**Transcript.** Each resolution records
`{ type: 'event-choice', turn, eventId, cardName, option, acceptNextCardId,
rejectNextCardId }`. The shape is identical for player and AI.

---

## 4. AI policy

Headless turns never stall: `resolveAiEventChoice` (re-exported from
`MainStreetAiStrategy.ts`, implemented via `resolvePendingEventChoice`) resolves
a pending choice by difficulty and completes the deferred closing.

`decideEventChoice(state, event, difficulty, pending?)` returns the **index** of
the automatically-chosen option **in the presented option list**:

- **Presented list only.** When the optional `pending` choice is supplied (the
  normal AI resolve path) the AI reads the frozen draw-time snapshot via
  `getPendingStorylineOptions(pending, state)`; the 3-argument form compiles the
  event against the current state via `getStorylineOptions(event, state)`. Both
  apply the draw-time filtering of the core presented-list compile — `condition`
  **and** affordability (`cost`) — so the AI can never select an option the
  player would not have been offered. The returned index addresses that
  presented list, never the raw unfiltered one.
- **Projected value, lowest wins.** Each presented option is scored by its
  projected value (table below); the option with the lowest projected value is
  chosen.

| Term | Contribution to the projected option value |
|------|--------------------------------------------|
| **Successor chain** | Worst-case (maximum) severity across the option's candidate set — a terminal option (no candidates) scores 0. Every CSV-authored option applies the event effect (`effectPolicy: 'apply'`, Q4=B), so the chain is the severity lever. |
| **`cost`** | `cost.coins` + `cost.reputation` × `REPUTATION_SEVERITY_SCALE`: the player **pays** it, so it adds to the value. |
| **`extraEffect`** | `extraEffect.coins` + `extraEffect.reputation` × `REPUTATION_SEVERITY_SCALE`: the player **receives** it, so it subtracts from the value. |

`REPUTATION_SEVERITY_SCALE` (100) is the same weight the severity model uses, so
coins and reputation stay comparable in both terms. Ties resolve to the **lowest
index** (index 0 is the presentation-default / legacy Accept slot). Options with
neither `cost` nor `extraEffect` project a delta of 0, so legacy binary choice
cards keep their pre-existing selection exactly (pinned by the storyline
regression harness).

The policy is a pure function of state and option and consumes no RNG (no
`state.rng`, `Math.random` or clock), so repeated calls on identical input
return the same index and seeded replays and Monte Carlo runs stay
byte-identical. `cost` / `extraEffect` are core option fields — their contract
(including the draw-time affordability gate and payment at resolution) is
documented once in
[`core/docs/core-engine/story-line.md`](../../core/docs/core-engine/story-line.md);
this section only describes how the AI projects them into option value. The
cost-gated, frozen-snapshot, extra-effect and tie-break cases are pinned by the
`cost-aware scoring` cases in
[`tests/main-street/MainStreetAiEventChoice.test.ts`](../../tests/main-street/MainStreetAiEventChoice.test.ts).

The former Easy/Medium/Hard accept/reject ladder was superseded by this shared
rule when the migrated model made Reject apply the effect too
(`MS-0MV8KQSF1004E53Y`). `difficulty` remains part of the API for callers and
future weighting (see §9 roadmap).

AI resolutions produce the same `event-choice` transcript entry as a player
choice, so replays are comparable.

---

## 5. Tooling

All scripts run under `vite-node` because the card model imports
`card-data.csv` through Vite's `?raw` query.

> **Where the authoring toolchain lives.** The *generic* story-line authoring
toolkit — content model + content adapter, CSV/checksum, deterministic
manifest/Mermaid generator, static validator, transactional author API and the
visual editor — now ships in core
([`core/docs/core-engine/story-line.md`](../../core/docs/core-engine/story-line.md),
[`core/docs/DEVELOPER.md`](../../core/docs/DEVELOPER.md), `src/story-line/content/`
and `src/story-line/editor/` in the core repo). Main Street's commands in this
section remain game-side wrappers over its own typed CSV model; supplying a
Main Street `ContentAdapter` so the core CLIs and the
`npm run storylines:editor` visual editor can drive this content is tracked in
the core worklog (`CG-0MVNE47TC0048WZ9`).

| Command | Purpose |
|---------|---------|
| `npm run validate:storylines` | Validate the shipped graph. Exits `0` when valid, `1` on a dangling link, unknown target, duplicate id, invalid option. Flags: `--json`, `--csv <path>`, `--fail-on-cycle`. |
| `npm run storylines:graph -- --format mermaid` | Regenerate `docs/dev/assets/storyline-graph.mmd` (choice cards as diamonds, `==>` for cycle edges). |
| `npm run storylines:graph -- --format json` | Regenerate `docs/dev/assets/storyline-manifest.json` (validates against `schemas/main-street-storyline.schema.json`). |
| `npm run storylines:graph -- --format json --check` | Drift guard: exit `1` when the committed artefact differs from `src/card-data.csv`. |
| `npm run storylines:graph:svg` | Render one SVG per storyline into `docs/game/assets/`, one document per storyline in `docs/game/storylines/`, the standalone-incident index, and the storyline index in `storylines.md` §7.2 — portable, viewable without a Mermaid renderer. |
| `npm run storylines:graph:svg -- --check` | Drift guard: exit `1` when any committed diagram, per-storyline document, index, or generated doc section differs from a re-render of the committed model. |
| `npm run storylines:author -- add-card …` | Safely append a card (validated before writing). |
| `npm run storylines:author -- link …` | Set choice links / storyline metadata on an existing card (validated before writing). |
| `npm run docs:diagrams` | Regenerate the card relationship diagrams (synergies, staff, upgrade chains, community spaces) into `docs/dev/assets/`; `--check` is the drift guard. See [card-diagrams.md](./card-diagrams.md). |

**Cycle policy.** The validator reports cycles as **informational** findings
(`RESULT: VALID`, exit `0`); pass `--fail-on-cycle` to treat them as errors. The
shipped tax chain is an intentional cycle.

**Opt-in pre-push reminder.** `sh src/scripts/install-storylines-pre-push.sh`
installs a **non-blocking** local pre-push reminder that runs the validator; it
never blocks an unrelated push and is not installed automatically. Remove it
with `--remove`.

---

## 6. Cycles are a first-class shape

Cycles are intentional (producer decision, 2026-09-29) and must not fail
validation:

- **Validator** — reports each cycle once as an informational finding.
- **Graph/manifest** — marks participating edges `cycle: true`; Mermaid renders
  them with `==>`.
- **Tests** — the shipped tax cycle is pinned structurally (`chain-content`),
  behaviourally (C1 harness), and in the manifest (`storyline-graph`).

---

## 7. Authoring walkthrough

This is the complete, copy-pasteable workflow. It matches the shipped tooling.

### 7.1 Declare a storyline and add a choice card

```sh
# 1. Add the first card of a new storyline, with a multi-outcome choice:
npm run storylines:author -- add-card \
  --id evt-river-festival --name "River Festival" \
  --effect "Lose 150 coins staging the festival" --coin-delta -150 \
  --options 'Accept|evt-good-press;Decline|evt-noise-complaint' \
  --storyline-id storyline-festival --storyline-title "Festival Season"

# 2. Add the escalation cards (plain incidents — they resolve normally):
npm run storylines:author -- add-card \
  --id evt-river-flood --name "River Flood" \
  --effect "Lose 500 coins repairing flood damage" --coin-delta -500 \
  --storyline-id storyline-festival --storyline-title "Festival Season"

# 3. Link an existing card into the storyline (optional):
npm run storylines:author -- link --id evt-award \
  --storyline-id storyline-festival --storyline-title "Festival Season"

# 4. Validate (the author command already validates before writing):
npm run validate:storylines

# 5. Regenerate the committed graph + manifest:
npm run storylines:graph -- --format mermaid
npm run storylines:graph -- --format json
```

`add-card` / `link` build the edited CSV in memory, load it through the typed
model and run the validator **before** any write. If the result is invalid the
command exits non-zero, prints the offending card/link, and leaves the CSV
untouched. Add `--dry-run` to validate without writing, or `--csv <path>` to
edit a fixture.

### 7.2 The shipped graph (documented chains)

The storyline graph is documented **per storyline**. Each storyline has its own
page — its diagram plus a per-event detail table covering the descriptive text,
trigger/tier/cost, game-state impact and choice routing. The combined graph was
unreadable: most incidents are standalone (not part of any chain) and Mermaid
laid them out in a single ~13,000px row of tiny boxes. Each per-storyline
document is generated by `npm run storylines:graph:svg` and drift-guarded, so it
never drifts from the manifest.

<!-- BEGIN GENERATED: storyline-doc-index -->
| Storyline | Events | Document |
|-----------|--------|----------|
| Economic Downturn (`storyline-economy`) | 2 | [`storylines/economy.md`](./storylines/economy.md) |
| Public Health Crisis (`storyline-health`) | 2 | [`storylines/health.md`](./storylines/health.md) |
| Labour Unrest (`storyline-labor`) | 2 | [`storylines/labor.md`](./storylines/labor.md) |
| Restaurant Renaissance (`storyline-restaurant`) | 2 | [`storylines/restaurant.md`](./storylines/restaurant.md) |
| Tax Troubles (`storyline-tax`) | 3 | [`storylines/tax.md`](./storylines/tax.md) |
<!-- END GENERATED: storyline-doc-index -->

Incidents that belong to no storyline chain are listed in the
[standalone-incident index](./storyline-incident-index.md) rather than drawn as
boxes.

The doc-drift test parses the table below and compares it to
`src/card-data.csv`. Keep it in sync with the shipped content. Each cell lists
the option's candidate successor card ids (comma-separated when the option can
fan out; `—` when terminal; the player-seen labels are `Accept` / `Reject`).

| Card id | Card name | Storyline | Accept → | Reject → |
|---------|-----------|-----------|----------|----------|
| `evt-tax` | Tax Audit | storyline-tax | — | `evt-tax-inquiry` |
| `evt-tax-error` | Error in Tax Return | storyline-tax | — | `evt-tax` |
| `evt-tax-inquiry` | Inquiry Commission | storyline-tax | `evt-tax-error` | — |
| `evt-flu-outbreak` | Flu Outbreak | storyline-health | — | `evt-pandemic` |
| `evt-recession` | Economic Recession | storyline-economy | — | `evt-depression, evt-general-strike` |
| `evt-strike-service` | Service Workers Strike | storyline-labor | — | `evt-general-strike` |
| `evt-popular-menu` | Popular Menu Item | storyline-restaurant | — | `evt-farm-table` |

Since the migration to the `options` model (`MS-0MV8KQQQ90044CM5`, Q4=B) every
CSV-authored option carries `effectPolicy: 'apply'`: choosing **Reject** no
longer skips the incident's effect — it applies it and then draws the option's
candidate successor (randomly, when the set has more than one entry). The
migrated content kept its recognisable branches (`evt-recession` fanning out to
`evt-depression` **or** `evt-general-strike` demonstrates the random fan-out).

Terminal escalation cards (`evt-pandemic`, `evt-depression`,
`evt-general-strike`, `evt-farm-table`) carry a storyline id for grouping but
are **plain incidents** — they resolve normally when drawn.

---

## 8. Authoring checklist

Before committing a storyline change:

- [ ] **Ids are unique** and use the `evt-` prefix (`validate:storylines` fails on duplicates).
- [ ] **Links resolve** — every `acceptNextCardId`/`rejectNextCardId` names an existing card.
- [ ] **Choice cards set `hasChoices`** (the author helper does this automatically when you set a link).
- [ ] **Storyline metadata** — choice cards and their escalations share a `storylineId`; the first card sets a `storylineTitle`.
- [ ] **Effects are intentional** — `apply` (`acceptNextCardId`) applies the incident effect; `skip` (`rejectNextCardId`) does not.
- [ ] **Cycles are intentional** — a cycle is allowed, but confirm it is a designed recurring thread.
- [ ] **`npm run validate:storylines` exits 0.**
- [ ] **`npm run storylines:graph -- --format mermaid` and `--format json` are regenerated and committed** (the drift test fails otherwise).
- [ ] **`npm run storylines:graph:svg` is regenerated and committed** when the graph changes (the SVG drift test fails otherwise).
- [ ] **Balance** — run the Monte Carlo guardrail (`npm test`) if the change alters economy-affecting effects.
- [ ] **Tests** — add/extend unit tests; the C1 regression harness must stay green.

---

## 9. Core-engine extraction path

The mechanic has been extracted into the generic, game-agnostic core module
[`@story-line`](../../core/docs/core-engine/story-line.md)
([`core/src/story-line/`](../../core/src/story-line/)). Main Street is now a
**consumer**: the three story-line modules are thin adapters over the core
system, so there is one implementation of compilation, resolution and the
journal helpers.

> **Doc-guard note:** `tests/main-street/storylines-doc-drift.test.ts` asserts
the *semantic anchors* of this engine reference (the `createStorylineSystem` /
`@story-line` / `GymStorylineScene` seam API, the documented section topics and
the links resolving) — never its Markdown heading text, which is engine prose
and not a cross-repo contract (MS-0MVMNO29Z009SF6O).

**The adapters** ([`src/MainStreetStorylineAdapter.ts`](../../src/MainStreetStorylineAdapter.ts)):

- `mainStreetStorylineEngineAdapter` maps the core engine seam onto
  `MainStreetState`: seeded `rng()`, `resolveEvent` effect application, the
  activity log, the incident-deck chain-card sink, and the
  `applyResourceDelta` settlement seam (declarative option `cost` / `extraEffect`
  mutate `resourceBank` and re-sync the shared `EconomyLedger`).
- `mainStreetStorylineUiAdapter` supplies Main Street's presentation (names,
  dialog labels, story-update lines, journal formatting). It is the core
  default implementation, which was extracted from Main Street, so the shipped
  wording is unchanged.
- `getMainStreetStorylineSystem()` composes them lazily.

**The Main Street API surface is unchanged**, delegating to the system:
[`src/MainStreetStoryline.ts`](../../src/MainStreetStoryline.ts) —
`compileStorylineFromEvent`, `getStorylineOptions`,
`registerStorylineOptions` / `resetStorylineRegistry`,
`createPendingStorylineChoice`, `resolveStorylineOption`, `pushChainCard`,
`markChoiceResolved`; [`src/MainStreetStorylineJournal.ts`](../../src/MainStreetStorylineJournal.ts)
and [`src/MainStreetStorylineUi.ts`](../../src/MainStreetStorylineUi.ts) delegate
the journal/clarity/name/update helpers. `resolveEventOption` in the engine
remains the generalised entry point.

**Migration notes:**

- Core owns the semantics: legacy/CSV compilation, registry precedence,
  draw-time condition filtering, `apply` / `skip`, successor precedence
  (`successorResolver` → one seeded candidate draw → legacy id) and
  deterministic `${base}-${maxSerial+1}` chain naming.
- A candidate selection consumes exactly **one** `state.rng()` draw at
  resolution time; terminal options consume no draw. Replay with the same seed
  is byte-for-byte identical, guarded by the behaviour-preservation parity gate
  in `tests/main-street/storyline-behaviour-parity.test.ts` and its golden
  fixtures.
- `condition` / `successorResolver` remain pure callbacks over
  `MainStreetState`; they are runtime-only and never serialised.
- `MainStreetCardsTypes.ts` re-exports the generic `StorylineOption` /
  `CompiledStoryline` types from core (specialised to `MainStreetState`), so
  there is no duplicate type definition.
- Main-Street-specific concerns stay game-side: the transcript
  (`recordStorylineResolution`), the overlay presentation, and this repo's
  `validate:storylines` / `storylines:graph` / `storylines:author` CLIs (bound
  to the typed `card-data.csv` model).
- The **generic authoring toolchain** (content adapter, CSV/checksum,
  manifest/Mermaid, validator, transactional author API) and the **visual
  editor** (`npm run storylines:editor`) live in core rather than this repo; see
  `core/docs/core-engine/story-line.md` and `core/docs/DEVELOPER.md`. A Main
  Street content adapter is tracked in the core worklog
  (`CG-0MVNE47TC0048WZ9`).

Full generic reference: [`core/docs/core-engine/story-line.md`](../../core/docs/core-engine/story-line.md).

## 10. Roadmap

Prioritised further work, deliberately deferred from the write-storylines epic.
Each is captured as a work item:

| Priority | Idea | Work item |
|----------|------|-----------|
| Medium | Storyline coverage analytics in the Monte Carlo harness (firing frequency, chain depth, cycle counts, choice win-rate impact). | `MS-0MUNB4ZXQ0081EX7` |
| Done | Render the committed Mermaid graph to SVG in the docs build and link it here. Delivered by `MS-0MUNB54KU005084C` (see §7.2). | `MS-0MUNB54KU005084C` |
| Low | Extend options with conditional/cost-gated effects (`StorylineOption` was designed to grow). | `MS-0MUNB58TK0025CB9` |
| Low | Callback escape hatch: arbitrary `condition` / `successorResolver` callbacks on storyline options. | `MS-0MUPORT1Z000QX8N` |
| Done | Visual storyline authoring editor backed by the manifest and the transactional author API. Shipped in core as `npm run storylines:editor` (see below). | `MS-0MUNB5D7K001GH19` |

**Delivered:** the visual editor now ships in core as
`npm run storylines:editor` — a local viewer plus guided, validated card and
story-line editing over the same transactional author API (work item
`MS-0MUNB5D7K001GH19`, delivered in core by `CG-0MVHZ1P1I000PVQ1`). It is a
core developer tool, documented in `core/docs/core-engine/story-line.md` and
`core/docs/DEVELOPER.md`; this repo's own authoring commands above are
unchanged.

---

## 11. Related documents

- [`src/README.md`](../../src/README.md) — CSV column reference (includes the storyline columns) and engine contracts.
- [`docs/game/content-design-and-progression.md`](./content-design-and-progression.md) — card inventory, economy and progression.
- [`docs/game/core-rules-and-mechanics.md`](./core-rules-and-mechanics.md) — turn structure and end-of-turn sequence.
- [`docs/dev/ai-strategy.md`](../dev/ai-strategy.md) — AI strategy overview.
- [`docs/dev/assets/storyline-graph.mmd`](../dev/assets/storyline-graph.mmd) — generated Mermaid graph (source of truth).
- [`docs/game/card-diagrams.md`](./card-diagrams.md) — the unified card relationship diagrams (synergies, staff, upgrade chains, community spaces) and their regeneration/drift-guard workflow.
- [`docs/game/storylines/`](./storylines/) — one document per storyline (diagram + per-event detail table): `tax.md`, `health.md`, `economy.md`, `labor.md`, `restaurant.md`.
- [`docs/game/assets/`](./assets/) — rendered per-storyline graph images (viewable without a Mermaid renderer).
- [`docs/game/storyline-incident-index.md`](./storyline-incident-index.md) — standalone-incident index (incidents not in any storyline).
- [`docs/dev/assets/storyline-manifest.json`](../dev/assets/storyline-manifest.json) — generated manifest.
- [`schemas/main-street-storyline.schema.json`](../../schemas/main-street-storyline.schema.json) — manifest JSON schema.
