# Card Test Framework

The card test framework verifies that every card in `src/card-data.csv`
behaves as its row declares, by exercising each card through real engine play
states and turn progressions. It records a per-card pass/fail outcome (with a
failure note) back into the CSV.

This document covers the **unit integration** suite (`tests/main-street/cards/unit`).
A sibling browser integration suite drives the same card definitions through
the real `MainStreetScene` (see the browser child work item).

## What it proves

- Every one of the 174 cards (31 business, 8 community-space, 39 upgrade,
  25 staff, 71 event) has an explicit test definition.
- Each definition acquires / plays the card through production engine APIs
  and asserts the resulting state against the card's declared fields — staff
  discounts and abilities, upgrade bonuses, event coin/reputation effects,
  and business/community-space income.
- The framework is not a green-but-useless suite: a card with no definition is
  reported as a failure, and a deliberately wrong expectation fails
  (`CardTestFramework.test.ts`).

## Running the suite

```bash
# Unit integration card tests only
npx vitest run --project unit tests/main-street/cards/unit/CardIntegration.test.ts

# Full unit suite (includes the card tests)
npm test
```

Running the suite rewrites `src/card-data.csv` with the latest outcomes. The
writer is **idempotent** — it only rewrites the file when a status or reason
actually changes — so re-running a green suite produces no diff.

## CSV result columns

Four columns are appended (once) to `src/card-data.csv`, after all existing
columns, preserving column order and row order:

| Column | Meaning |
|---|---|
| `unitTestStatus` | `pass` or `fail` for the unit integration definition |
| `unitTestFailReason` | concise failure note; empty on pass |
| `browserTestStatus` | `pass` or `fail` for the browser integration definition |
| `browserTestFailReason` | concise failure note; empty on pass |

The CSV remains backward compatible: `@balance-cards` validates the known
header prefix and ignores trailing columns, and the card-art pipeline reads
only the columns it needs.

## Architecture

| Path | Responsibility |
|---|---|
| `CardTestTypes.ts` | Shared types (`CardRow`, `CardDefinition`, results, context) |
| `CardTestRegistry.ts` | Discovers every CSV card, resolves definitions, runs them, reports missing definitions as failures |
| `CardTestResultWriter.ts` | Appends/updates the four result columns (atomic, idempotent) |
| `definitions/index.ts` | The explicit `cardId → definition` registry (one entry per card) |
| `definitions/runners.ts` | Shared per-family verification bodies (placeable, upgrade, staff, event) |
| `definitions/combinations.ts` | Up to three staff combination checks (discount stacking, per-business scoping, upgrade interaction) |
| `helpers/cardFixture.ts` | Resolves fresh engine templates via the production deck factories |
| `helpers/stateBuilders.ts` | Deterministic, applicant-free controlled-state builders |
| `unit/CardIntegration.test.ts` | Parameterised runner over all discovered cards + CSV write-back |
| `unit/CardCombinations.test.ts` | Staff combination runner |
| `unit/CardTestFramework.test.ts` | Meta-tests for the framework and writer |

### Staff combination tests

Each staff card is additionally covered by up to three cross-card combination
checks (`definitions/combinations.ts`), selected from its declared abilities:

| Combination | Applies to | Verifies |
|---|---|---|
| `purchase-discount-stacking` | staff with `purchaseCostDiscount` | hiring every purchase-discount provider sums the street-wide discount |
| `refresh-discount-stacking` | staff with `refreshCostDiscount` | hiring every refresh-discount provider sums the refresh discount |
| `per-business-scoping` | staff with `upgradeCostDiscount` | the discount applies only at the employing business, not street-wide |
| `upgrade-interaction` | staff with `upgradeCostDiscount` | the discounted upgrade cost is charged and the upgrade still applies |

### How a definition runs

1. `CardTestRegistry.discoverCards()` reads `getCsvRows()` (the production
   CSV parser) and returns every row with its id/family/name.
2. For each row, the registry looks up the explicit definition. A missing
   definition yields a `fail` result with a clear reason — never a skip.
3. `resolveCardTemplate(id, family)` builds a fresh engine template with the
   production deck factories (never a re-implemented parser).
4. The family runner drives real engine APIs (e.g. `purchaseBusiness`,
   `hireStaffCard`, `purchaseUpgrade`, `purchaseEvent` / `playEventFromHand`,
   `resolveEvent`, `executeWeekStart`, `endTurnHeadless`) and asserts the
   declared outcomes.
5. `writeCardTestResults()` records pass/fail and the failure note back into
   `src/card-data.csv`.

## Adding a test definition for a new card

1. Add the card row to `src/card-data.csv`.
2. Add a definition to `tests/main-street/cards/definitions/index.ts`:

   ```ts
   { cardId: 'biz-new-card', family: 'business', verifies: '…', run: verifyPlaceableCard },
   ```

   Use the family runner (`verifyPlaceableCard`, `verifyUpgradeCard`,
   `verifyStaffCard`, `verifyEventCard`). If the card needs bespoke mechanics,
   add a dedicated runner in `runners.ts` and reference it.

No framework changes are required — the registry discovers the card and runs
its definition automatically.

## Determinism

Runners seed `setupMainStreetGame` per card, suppress the incidental staff
applicant, fund a safe coin balance (below the win threshold, above every
listed cost), and clear the incident deck before a turn-progression assertion.
Event targets are populated explicitly so targeted events have a defined
population.
