# Staff Effect Audit

> **Tracking epic:** [MS-0MW6HEBP80070YND](https://github.com/TheWizardsCode/tce-main-street/issues/MS-0MW6HEBP80070YND) — *Staff effects are not implemented*
> **Audit child:** MS-0MW8AG3VS009GBDP — *Refresh and record the 26-card staff effect audit*
> **Date:** 2026-11-08
> **Status:** All 26 base staff cards are fully implemented end-to-end (the Bookkeeper's −20% ongoing-cost effect landed in MS-0MW7D0LGL007PAUY), and the card-level `unitTestStatus` is now honest: `verifyStaffCard` asserts every declared effect field — including the dedicated management-company columns — so a card whose effect is absent or mis-parsed cannot report `pass` (MS-0MW8AG48V005OX8J, completed by MS-0MW6HEBP80070YND).

## Summary

Every staff card advertises an ability. This audit verifies, card by card, that each ability is:

1. **documented** — stated in GDD Appendix D.4.3 (business staff) or D.4.4 (management-company staff) and mirrored in `docs/game/card-catalog.md`;
2. **backed by card data** — carried in a column of the card's `src/card-data.csv` row (an `effect`-column dimension, or a dedicated column);
3. **parsed into a typed `StaffCard` field** — by `parseStaffEffect` (for the `effect` column) or the dedicated-column mapping in `src/MainStreetCardsTemplates.ts`;
4. **consumed by the engine** — a named function folds the typed field into income, reputation, ongoing cost, incident, purchase or turn behaviour;
5. **covered behaviourally** — at least one automated test exercises the effect through real engine state and asserts the documented magnitude **and scope** (own business vs. 8-way neighbours vs. player/street), not merely that the card can be hired.

Of the **26 base staff templates shipped in `src/card-data.csv`** (17 business staff, 9 management-company staff), **all 26 are fully implemented and behaviourally tested**. A 27th staff template lives in the residential pack (`packs/main-street/main-street-residential-pack/cards.csv`, `stf-ms-residential-community-gardener`) and is implemented; it is outside the 26-card base roster audited here.

## Verdict legend

| Symbol | Meaning |
|---|---|
| ✅ | Documented, backed by data, parsed, consumed by the engine, and asserted by a behavioural test. |
| ✅\* | Implemented and behaviourally exercised, but its only effect assertion is the shared `verifyStaffCard` hire verifier (still a real engine assertion for hand slots / actions / market / peek). |
| ❌ | Documented but **not** implemented (missing data, parser dimension or engine consumer) and/or **not** behaviourally tested. |

## Card-by-card audit — management-company staff (9)

Management-company staff are employed by the player (no `employedAtSlot`) and carry a player/turn-scoped ability. `handSlotsAdded` and `actionsPerTurn` are read at week start; `refreshCostDiscount` at market refresh; `taxAuditRate` on a proportional Tax Audit; `peekOncePerTurn` on the incident peek action; `reputationPerTurn` in the income (reputation) phase; and `freeMarketRerollPerTurn` / `marketRelevanceBias` on the free market re-roll.

| # | Card ID | Role | Documented effect (GDD D.4.4) | Backing data | Parser path | Engine consumer | Behavioural test file(s) | Status |
|---|---------|------|-------------------------------|--------------|-------------|-----------------|--------------------------|--------|
| 1 | `staff-apprentice` | Apprentice | +1 hand slot | `handSlotsAdded=1` | dedicated column → `StaffCard.handSlotsAdded` | `maxHandSize` (WeekStart) | `tests/main-street/staff-hand-slot-effects.test.ts` (Apprentice-specific); `tests/main-street/group-f-staff-abilities-expansion.test.ts`; `verifyStaffCard` | ✅ |
| 2 | `staff-assistant` | Assistant | +2 hand slots | `handSlotsAdded=2` | dedicated column → `StaffCard.handSlotsAdded` | `maxHandSize` (WeekStart) | `tests/main-street/staff-two-type-redesign.test.ts`; `tests/main-street/group-f-staff-abilities-expansion.test.ts`; `verifyStaffCard` | ✅ |
| 3 | `staff-manager` | Manager | +1 hand slot and +1 action/turn | `handSlotsAdded=1`, `actionsPerTurn=1` | dedicated columns → `StaffCard.handSlotsAdded` / `actionsPerTurn` | `maxHandSize` (WeekStart), `actionsRemaining` (WeekStart / CompetitiveTurn) | `tests/main-street/group-f-staff-abilities-expansion.test.ts`; `verifyStaffCard` | ✅ |
| 4 | `staff-director` | Director | +3 hand slots and +1 action/turn | `handSlotsAdded=3`, `actionsPerTurn=1` | dedicated columns | `maxHandSize` (WeekStart), `actionsRemaining` (WeekStart / CompetitiveTurn) | `tests/main-street/staff-hand-slot-effects.test.ts` (Director-specific hand slots + action); `tests/main-street/group-f-staff-abilities-expansion.test.ts`; `verifyStaffCard` | ✅ |
| 5 | `staff-executive` | Executive | +2 actions/turn (0 hand slots) | `handSlotsAdded=0`, `actionsPerTurn=2` | dedicated columns | `actionsRemaining` (WeekStart / CompetitiveTurn) | `tests/main-street/staff-two-type-redesign.test.ts`; `tests/main-street/group-f-staff-abilities-expansion.test.ts`; `verifyStaffCard` | ✅ |
| 6 | `staff-general-manager` | General Manager | +4 hand slots and +1 action/turn | `handSlotsAdded=4`, `actionsPerTurn=1` | dedicated columns | `maxHandSize` (WeekStart), `actionsRemaining` (WeekStart / CompetitiveTurn) | `tests/main-street/staff-hand-slot-effects.test.ts` (General Manager-specific hand slots + action); `verifyStaffCard`; `tests/main-street/staff-business-type-matching.test.ts` | ✅ |
| 7 | `staff-socialite` | Socialite | +1 hand slot and +10 reputation/turn | `reputationPerTurn=10`, `handSlotsAdded=1` | dedicated columns → `StaffCard.reputationPerTurn` / `handSlotsAdded` | `maxHandSize` (WeekStart); `reputationPerTurn` folded in the income/reputation phase (`MainStreetAdjacencyScoring.applyIncome`) | `tests/main-street/group-f-staff-abilities-expansion.test.ts` (Socialite reputation ability, behavioural); `tests/main-street/staff-hand-slot-effects.test.ts` (Socialite hand slot); `verifyStaffCard` | ✅ |
| 8 | `staff-accountant` | Accountant | +1 hand slot, −100 coins on every market refresh, Tax Audit losses capped at 25% | `handSlotsAdded=1`, `refreshCostDiscount=100`, `taxAuditRate=0.25` | dedicated columns → `StaffCard.refreshCostDiscount` / `taxAuditRate` | `refreshMarketCost` (`MainStreetMarketRefill`); `computeTaxAuditRate` (`MainStreetEngineEvents`) | `tests/main-street/group-f-staff-abilities-expansion.test.ts` (refresh discount, behavioural); `tests/main-street/staff-hand-slot-effects.test.ts` (Accountant hand slot); `verifyStaffCard` (hand slots, refresh, tax) | ✅ |
| 9 | `staff-lookout` | Lookout | +1 hand slot and reveal the top incident card once per turn (peek) | `handSlotsAdded=1`, `peekOncePerTurn=1` | dedicated columns → `StaffCard.handSlotsAdded` / `peekOncePerTurn` | `maxHandSize` (WeekStart); `hasPeekCapableStaff` (`MainStreetStaffSkills`) → `MainStreetEngineActions` | `tests/main-street/group-f-staff-abilities-expansion.test.ts`; `verifyStaffCard` (peek) | ✅ |

## Card-by-card audit — business staff (17)

Business staff are employed at a single business (`employedAtSlot`) and their ability resolves **per business** — against the employing business (`own`) or its 8-way neighbours (`adjacent`), and for incident effects against the local `cluster` (own + neighbours). Business-staff effects ride in the row's `effect` column and are parsed by `parseStaffEffect`; the Financial Advisor uses the dedicated `upgradeCostDiscount` column and the Investor uses the dedicated `freeMarketRerollPerTurn` / `marketRelevanceBias` columns.

| # | Card ID | Role | Documented effect (GDD D.4.3) | Backing data | Parser path | Engine consumer | Behavioural test file(s) | Status |
|---|---------|------|-------------------------------|--------------|-------------|-----------------|--------------------------|--------|
| 10 | `staff-barista` | Barista | +20 coins/turn to each adjacent Food business | `effect=income:adjacent:20:Food` | `parseStaffEffect` → `incomeBonus` + `incomeBonusTarget='adjacent'` + `incomeBonusTypes=['Food']` | `computeBusinessStaffBuffs` (`MainStreetStaffBuffs`) → income phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (adjacency income, own vs. 8-way scope; employer gets no buff) | ✅ |
| 11 | `staff-security` | Security Guard | −10% incident coin damage for its own business and adjacent businesses (rounded down) | `effect=incident-coin:cluster:10` | `parseStaffEffect` → `incidentEffect {kind:'coin', amount:0.1, target:'cluster'}` | `computeBusinessIncidentMitigation` → incident resolution (`MainStreetEngineEvents`) | `tests/main-street/staff-two-type-redesign.test.ts` (cluster mitigation + out-of-cluster negative) | ✅ |
| 12 | `staff-marketing` | Marketing Consultant | +10% reputation from all sources for its own business | `effect=reputation:percent:10` | `parseStaffEffect` → `reputationPercent=0.1` | `computeBusinessStaffBuffs` → reputation phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (own-business reputation percent) | ✅ |
| 13 | `staff-bookkeeper` | Bookkeeper | −20% ongoing cost of its own business (rounded to the nearest integer, floored at 0) | `effect=ongoing-cost:percent:20` | `parseStaffEffect` → `ongoingCostReduction=0.2` | `computeBusinessOngoingCostReductionPct` → `applyBusinessOngoingCosts` / `applyCompetitiveOngoingCosts` (per business, before the street-wide Cost Cutter, floored at 0) | `tests/main-street/staff-bookkeeper-ongoing-cost.test.ts`; `tests/main-street/staff-cost-text-data-consistency.test.ts` | ✅ (MS-0MW7D0LGL007PAUY) |
| 14 | `staff-customer-rep` | Customer Service Rep | +10 reputation/turn to each adjacent business | `effect=reputation:adjacent:10` | `parseStaffEffect` → `reputationBonus` + `reputationBonusTarget='adjacent'` | `computeBusinessStaffBuffs` → reputation phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (adjacency reputation, never the employing business) | ✅ |
| 15 | `staff-it` | IT Specialist | +1 synergy range for its own business (links up to 2 slots away) | `effect=synergy-range:1` | `parseStaffEffect` → `synergyRangeBonus=1` | `computeBusinessStaffBuffs` → adjacency scoring (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (2-slot synergy link) | ✅ |
| 16 | `staff-health-safety` | Health & Safety Inspector | −10% incident frequency for its own business (deterministic per-turn avert) | `effect=incident-frequency:own:10` | `parseStaffEffect` → `incidentEffect {kind:'frequency', amount:0.1, target:'own'}` | `computeIncidentFrequencyReduction` → incident resolver (`MainStreetEngineEvents`) | `tests/main-street/staff-two-type-redesign.test.ts` (own business only + avert path) | ✅ |
| 17 | `staff-event-planner` | Event Planner | +100 coins/turn from each adjacent Entertainment business | `effect=income:adjacent:100:Entertainment` | `parseStaffEffect` → `incomeBonus` + `incomeBonusTarget='adjacent'` + `incomeBonusTypes=['Entertainment']` | `computeBusinessStaffBuffs` → income phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (adjacent Entertainment income; employer gets no buff) | ✅ |
| 18 | `staff-delivery` | Delivery Driver | −50 coins on the purchase cost of any business placed adjacent to its own business | `effect=purchase-discount:adjacent:50` | `parseStaffEffect` → `adjacencyPurchaseDiscount=50` | `computeAdjacentPurchaseDiscount` → purchase paths (`MainStreetMarketPurchase`, click/drag/play-from-hand) | `tests/main-street/staff-two-type-redesign.test.ts` (placement-scoped discount + no street-wide leak) | ✅ |
| 19 | `staff-pr` | PR Officer | +15 reputation/turn to its own business | `effect=reputation:own:15` | `parseStaffEffect` → `reputationBonus` + `reputationBonusTarget='own'` | `computeBusinessStaffBuffs` → reputation phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (own business only, once) | ✅ |
| 20 | `staff-financial` | Financial Advisor | −100 coins on each upgrade purchased for its own business (floored at 0) | `upgradeCostDiscount=100` | dedicated column → `StaffCard.upgradeCostDiscount` | `computeUpgradeCostDiscount` → market / hand / drag upgrade purchase paths | `tests/main-street/financial-advisor-upgrade-discount.test.ts`; `verifyStaffCard` | ✅ |
| 21 | `staff-maintenance` | Maintenance Worker | −50 reputation damage from Incidents for its own business and adjacent businesses | `effect=incident-reputation:cluster:50` | `parseStaffEffect` → `incidentEffect {kind:'reputation', amount:50, target:'cluster'}` | `computeBusinessIncidentMitigation` → incident resolution (`MainStreetEngineEvents`) | `tests/main-street/staff-two-type-redesign.test.ts` (cluster reputation mitigation) | ✅ |
| 22 | `staff-investor` | Investor | One coin-free, action-free market re-roll per turn, 75% biased toward its own business's synergy types | `freeMarketRerollPerTurn=1`, `marketRelevanceBias=0.75` | dedicated columns → `StaffCard.freeMarketRerollPerTurn` / `marketRelevanceBias` | `MainStreetMarketRefill` (free re-roll draw + relevance bias) | `tests/main-street/investor-staff.test.ts`; `tests/main-street/investor-free-reroll-engine.test.ts` | ✅ |
| 23 | `staff-florist` | Florist | +30 coins/turn to each adjacent Commerce or Culture business | `effect=income:adjacent:30:Commerce\|Culture` | `parseStaffEffect` → `incomeBonus` + `incomeBonusTarget='adjacent'` + `incomeBonusTypes=['Commerce','Culture']` | `computeBusinessStaffBuffs` → income phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (adjacent Commerce/Culture only) | ✅ |
| 24 | `staff-baker` | Baker | +25 coins/turn to its own business | `effect=income:own:25` | `parseStaffEffect` → `incomeBonus` + `incomeBonusTarget='own'` | `computeBusinessStaffBuffs` → income phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (own business only) | ✅ |
| 25 | `staff-chef` | Chef | +20% coin income to its own business (after synergy, before market saturation) | `effect=income:percent:20` | `parseStaffEffect` → `incomePercent=0.2` | `computeBusinessStaffBuffs` → income phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (own business only, percent) | ✅ |
| 26 | `staff-mechanic` | Mechanic | +30 coins/turn to its own (Service) business | `effect=income:own:30` | `parseStaffEffect` → `incomeBonus` + `incomeBonusTarget='own'` | `computeBusinessStaffBuffs` → income phase (`MainStreetAdjacencyScoring`) | `tests/main-street/staff-two-type-redesign.test.ts` (own Service business only) | ✅ |

**Pack staff (outside the 26 base roster).** `stf-ms-residential-community-gardener` (residential pack) ships `handSlotsAdded=1` and is consumed by `maxHandSize` like any management-company card — implemented.

## Gap register

Every gap found by the audit, stated explicitly.

### G1 — Bookkeeper −20% ongoing cost is not implemented (functional gap) — **CLOSED**

Fixed by MS-0MW7D0LGL007PAUY: `staff-bookkeeper` now ships `effect=ongoing-cost:percent:20`, `parseStaffEffect` parses it into `StaffCard.ongoingCostReduction`, `computeBusinessOngoingCostReductionPct` aggregates the employing business's staff, and both `applyBusinessOngoingCosts` and `applyCompetitiveOngoingCosts` apply the reduction per business (before the street-wide Cost Cutter, floored at 0). Behavioural coverage lives in `tests/main-street/staff-bookkeeper-ongoing-cost.test.ts` and the guard in `tests/main-street/staff-cost-text-data-consistency.test.ts`. The original gap and its required state are recorded below for history.

| Layer | Was | Required |
|---|---|---|
| Card data | `staff-bookkeeper`'s `effect` cell is empty. | `effect=ongoing-cost:percent:20` (existing `effect` grammar — no new CSV column, because card packs are validated against the exact header). |
| Type | `StaffCard` has no per-business ongoing-cost field. | A typed field (e.g. `ongoingCostReduction` as a fraction) documented as business-scope only. |
| Parser | `parseStaffEffect` has no `ongoing-cost` dimension. | Parse `ongoing-cost:percent:20` → the typed field. |
| Engine | `applyBusinessOngoingCosts` / `applyCompetitiveOngoingCosts` apply only the street-wide Cost Cutter reduction. | Apply the employing business's Bookkeeper reduction per business during the ongoing-cost phase, floored at 0. |
| Test | No behavioural test asserts the reduction or its own-business scope. | A behavioural test asserting the −20% own-business reduction and no street leakage. |

**Tracked as:** [MS-0MW7D0LGL007PAUY](https://github.com/TheWizardsCode/tce-main-street/issues/MS-0MW7D0LGL007PAUY) — **resolved** (see above). The Bookkeeper per-card child MS-0MW8AHNBK008FMA1 records the per-card verification.

### G2 — Card-level `unitTestStatus` was vacuous for business staff (verification gap) — **CLOSED**

Fixed by MS-0MW8AG48V005OX8J: `verifyStaffCard` now places each business-staff card on a real business and asserts every declared effect field through the engine — `incomeBonus` (+`incomeBonusTarget`/`incomeBonusTypes`), `incomePercent`, `reputationBonus` (+`reputationBonusTarget`), `reputationPercent`, `synergyRangeBonus`, `adjacencyPurchaseDiscount`, `ongoingCostReduction`, `incidentEffect`, `upgradeCostDiscount`, `freeMarketRerollPerTurn`/`marketRelevanceBias`, and `reputationPerTurn`. A raw-row honesty guard additionally fails the card when `card-data.csv` declares an effect the parsed template does not carry — covering the `effect`-column dimensions **and** the dedicated management-company columns (`handSlotsAdded`, `actionsPerTurn`, `refreshCostDiscount`, `taxAuditRate`, `peekOncePerTurn`, `reputationPerTurn`, `upgradeCostDiscount`, `purchaseCostDiscount`, `freeMarketRerollPerTurn`, `marketRelevanceBias`) — so a parser gap cannot report `pass`. Meta-tests in `tests/main-street/cards/unit/CardTestFramework.test.ts` prove a card with an unasserted effect yields `fail` and all 26 staff rows still pass. The original gap is recorded below for history.

`verifyStaffCard` (`tests/main-street/cards/definitions/runners.ts`) used to assert hire cost, hand slots, the legacy street-wide purchase discount, the refresh discount, the tax rate, actions per turn, the upgrade discount and the peek flag — but **not**:

- `incomeBonus` / `incomeBonusTarget` / `incomeBonusTypes` (Barista, Florist, Event Planner, Baker, Mechanic),
- `incomePercent` (Chef),
- `reputationBonus` / `reputationBonusTarget` (Customer Service Rep, PR Officer),
- `reputationPercent` (Marketing Consultant),
- `synergyRangeBonus` (IT Specialist),
- `adjacencyPurchaseDiscount` (Delivery Driver),
- `freeMarketRerollPerTurn` / `marketRelevanceBias` (Investor),
- the Bookkeeper's ongoing-cost reduction (implemented in MS-0MW7D0LGL007PAUY).

Because the card integration runner writes `unitTestStatus = pass` from `verifyStaffCard`, a business-staff card whose per-business effect was removed could previously still report `pass`. The **CSV-level** status column now reflects the behavioural assertion.

**Tracked as:** [MS-0MW8AG48V005OX8J](https://github.com/TheWizardsCode/tce-main-street/issues/MS-0MW8AG48V005OX8J) — **resolved**.

### G3 — Behavioural coverage depth

Every staff card — including the Bookkeeper — has at least one behavioural test that exercises its documented effect through real engine state. Bookmarks:

- Management-company cards are asserted by `verifyStaffCard` and, where the ability is richer than a hand-slot grant, by a dedicated behavioural test (`group-f-staff-abilities-expansion.test.ts` for the Socialite reputation and Accountant refresh; `financial-advisor-upgrade-discount.test.ts` for the Financial Advisor; `investor-*.test.ts` for the Investor).
- The Apprentice, Director, Socialite, Accountant and General Manager each have a card-named behavioural test in `tests/main-street/staff-hand-slot-effects.test.ts` that hires that specific card and asserts its hand-slot grant (plus the action grant for the Director and General Manager) against real engine state.
- The Bookkeeper is covered by `tests/main-street/staff-bookkeeper-ongoing-cost.test.ts` (the −20% reduction, own-business scope, clamp and Cost Cutter stacking), on top of the guard in `staff-cost-text-data-consistency.test.ts`.

## How the verdicts were determined

Each staff card was inspected for five things:

1. **Documented effect and scope** — read from GDD Appendix D.4.3 / D.4.4 and cross-checked against `docs/game/card-catalog.md` and the row's `description`.
2. **Backing data** — a non-empty column in the card's `src/card-data.csv` row (`effect`-column dimension or dedicated column).
3. **Parser path** — the code that turns the raw column into a typed `StaffCard` field:
   - `src/MainStreetCardsTemplates.ts::parseStaffEffect()` — the `effect`-column grammar;
   - the dedicated-column mapping in the same file — `handSlotsAdded`, `actionsPerTurn`, `refreshCostDiscount`, `taxAuditRate`, `peekOncePerTurn`, `reputationPerTurn`, `upgradeCostDiscount`, `freeMarketRerollPerTurn`, `marketRelevanceBias`.
4. **Engine consumer** — the named function that folds the typed field into gameplay:
   - `src/MainStreetStaffBuffs.ts` — `computeBusinessStaffBuffs`, `computeBusinessIncidentMitigation`, `computeIncidentFrequencyReduction`, `computeAdjacentPurchaseDiscount`, `computeUpgradeCostDiscount`;
   - `src/MainStreetAdjacencyScoring.ts` — income / reputation phase fold-in;
   - `src/MainStreetEngineCommands.ts` — ongoing-cost deduction (business, staff, community), `computeTaxAuditRate`;
   - `src/MainStreetEngineEvents.ts` — incident resolution (coin/reputation damage, tax rate);
   - `src/MainStreetMarketRefill.ts` — refresh discount, free re-roll and relevance bias;
   - `src/MainStreetEngineActions.ts` / `src/MainStreetStaffSkills.ts` — peek ability;
   - week-start / competitive-turn code — hand slots and actions per turn.
5. **Behavioural test** — a test file that drives the effect through real engine state (not just a template/CSV assertion) and checks magnitude **and scope**.

## Reproducible re-run procedure

To re-run this audit against the current card data:

1. **List every base staff row and its effect-relevant columns.**
   ```bash
   python3 - <<'PY'
   import csv
   with open('src/card-data.csv') as f:
       rows = list(csv.DictReader(f))
   staff = [r for r in rows if r['family'] == 'staff']
   cols = ['effect', 'handSlotsAdded', 'actionsPerTurn', 'refreshCostDiscount',
           'taxAuditRate', 'peekOncePerTurn', 'reputationPerTurn',
           'upgradeCostDiscount', 'freeMarketRerollPerTurn', 'marketRelevanceBias']
   print(f'{len(staff)} base staff rows')
   for r in staff:
       print(r['id'], {c: r[c] for c in cols if r.get(c)})
   PY
   ```
   Confirm there are exactly **26** base staff rows and that every row except `staff-bookkeeper` carries at least one non-empty effect column.

2. **Check the `effect` spec parser covers every shipped dimension.**
   ```bash
   grep -n "parseStaffEffect\|case 'income'\|case 'reputation'\|case 'purchase-discount'\|case 'incident-\|ongoing-cost" src/MainStreetCardsTemplates.ts
   ```
   A documented effect whose dimension has no `case` in `parseStaffEffect` is a gap (this is how G1 was found).

3. **Check each buff consumer exists.**
   ```bash
   grep -n "export function computeBusinessStaffBuffs\|computeBusinessIncidentMitigation\|computeIncidentFrequencyReduction\|computeAdjacentPurchaseDiscount\|computeUpgradeCostDiscount" src/MainStreetStaffBuffs.ts
   ```

4. **Check the ongoing-cost path applies per-business reductions.**
   ```bash
   grep -n "applyBusinessOngoingCosts\|applyCompetitiveOngoingCosts" src/MainStreetEngineCommands.ts
   ```
   Inspect whether each business's `ongoingCost` is reduced by its employed staff (the Bookkeeper), not only by the street-wide Cost Cutter.

5. **Check the card-level verifier asserts each effect field.**
   ```bash
   grep -n "incomeBonus\|reputationBonus\|reputationPercent\|incomePercent\|synergyRangeBonus\|adjacencyPurchaseDiscount\|freeMarketRerollPerTurn\|ongoingCostReduction" tests/main-street/cards/definitions/runners.ts
   ```
   A field absent from `verifyStaffCard` is a `unitTestStatus` honesty gap (G2).

6. **Check the behavioural suite references each card.**
   ```bash
   for id in $(python3 - <<'PY'
   import csv
   with open('src/card-data.csv') as f:
       print('\n'.join(r['id'] for r in csv.DictReader(f) if r['family'] == 'staff'))
   PY
   ); do
     echo "== $id =="
     grep -rl "$id" tests/main-street --include='*.test.ts' | grep -v 'cards/definitions'
   done
   ```
   A card with no referencing behavioural test (other than the shared verifier) is a behavioural-coverage gap.

7. **Run the guard and the shared card verifier.**
   ```bash
   npx vitest run tests/main-street/staff-cost-text-data-consistency.test.ts
   npx vitest run --project unit tests/main-street/cards/unit/CardIntegration.test.ts
   ```
   `staff-cost-text-data-consistency.test.ts` fails if a cost-reduction description is unregistered; the card integration run re-writes `unitTestStatus` in `src/card-data.csv`.

## Regression guard

`tests/main-street/staff-cost-text-data-consistency.test.ts` (CG-0MTKMGL66004I0PC) ensures every staff cost-reduction description is registered in a contract table and that the stated amount matches the backing data column (the ×100 consistency rule). Cards with no backing data must be registered with `column: null` and a note linking to their gap work item; no shipped staff card currently needs that escape hatch — the Bookkeeper is registered against its `effect` column with `expectedAmount: 20`. This prevents a future staff card from silently introducing a cost-reduction description that does nothing.

The broader implementation is additionally guarded by:

- `tests/main-street/staff-two-type-redesign.test.ts` — card-data values, per-business income/reputation buffs, incident mitigation and employment scoping.
- `tests/main-street/group-f-staff-abilities-expansion.test.ts` — management-company abilities (Socialite, Accountant, action economy, peek, Investor flag).
- `tests/main-street/financial-advisor-upgrade-discount.test.ts` — per-business upgrade discount.
- `tests/main-street/investor-staff.test.ts` / `investor-free-reroll-engine.test.ts` — Investor free re-roll, bias and lifecycle.
- `tests/main-street/gdd-staff-consistency.test.ts` + `npm run validate:gdd` — roster count/type/tier/salary consistency between the GDD and `src/card-data.csv`.
