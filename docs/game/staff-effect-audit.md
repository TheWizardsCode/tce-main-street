# Staff Effect Audit

> **Generated for:** MS-0MW4YAV24001Z7C6 — *Ensure all staff effects are implemented*
> **Date:** 2026-11-08
> **Status:** All shipped staff effects are backed by data and engine consumers, except the Bookkeeper (tracked as MS-0MW7D0LGL007PAUY).

## Summary

Every staff card advertises an ability. This audit verifies that each ability is backed by card data **and** applied by the engine. Of the 27 shipped staff templates (26 base + 1 pack staff), 26 are fully implemented and one (the Bookkeeper) is not.

| # | Staff ID | Advertised ability | Backing data | Engine consumer | Status |
|---|----------|-------------------|--------------|-----------------|--------|
| 1 | `staff-assistant` | +2 hand slots | `handSlotsAdded=2` | `maxHandSize` (WeekStart / AiStrategy) | ✅ |
| 2 | `staff-manager` | +1 hand slot, +1 action | `handSlotsAdded=1`, `actionsPerTurn=1` | WeekStart / CompetitiveTurn | ✅ |
| 3 | `staff-director` | +3 hand slots, +1 action | `handSlotsAdded=3`, `actionsPerTurn=1` | WeekStart / CompetitiveTurn | ✅ |
| 4 | `staff-apprentice` | +1 hand slot | `handSlotsAdded=1` | `maxHandSize` | ✅ |
| 5 | `staff-executive` | +2 actions | `actionsPerTurn=2` | WeekStart / CompetitiveTurn | ✅ |
| 6 | `staff-socialite` | +1 hand slot, +10 rep/turn | `handSlotsAdded=1`, `reputationPerTurn=10` | `applyIncome` (AdjacencyScoring) | ✅ |
| 7 | `staff-accountant` | +1 hand slot, refresh −100, Tax 25% | `handSlotsAdded=1`, `refreshCostDiscount=100`, `taxAuditRate=0.25` | `refreshMarketCost`, `computeTaxAuditRate` | ✅ |
| 8 | `staff-general-manager` | +1 action, +4 hand slots | `actionsPerTurn=1`, `handSlotsAdded=4` | WeekStart / CompetitiveTurn | ✅ |
| 9 | `staff-lookout` | peek once/turn | `peekOncePerTurn=1` | `hasPeekCapableStaff` / EngineActions | ✅ |
| 10 | `staff-barista` | +20 coins each adjacent Food | `effect=income:adjacent:20:Food` | `computeBusinessStaffBuffs` | ✅ |
| 11 | `staff-security` | −10% incident coin (own+adjacent) | `effect=incident-coin:cluster:10` | `computeBusinessIncidentMitigation` | ✅ |
| 12 | `staff-marketing` | +10% reputation own business | `effect=reputation:percent:10` | `computeBusinessStaffBuffs` | ✅ |
| 13 | `staff-bookkeeper` | −20% ongoing cost own business | **none** | **none** | ❌ — tracked as [MS-0MW7D0LGL007PAUY](https://github.com/TheWizardsCode/tce-main-street/issues/MS-0MW7D0LGL007PAUY) |
| 14 | `staff-customer-rep` | +10 rep each adjacent business | `effect=reputation:adjacent:10` | `computeBusinessStaffBuffs` | ✅ |
| 15 | `staff-it` | +1 synergy range | `effect=synergy-range:1` | `computeBusinessStaffBuffs` | ✅ |
| 16 | `staff-health-safety` | −10% incident frequency own | `effect=incident-frequency:own:10` | `computeIncidentFrequencyReduction` | ✅ |
| 17 | `staff-event-planner` | +100 coins each adjacent Entertainment | `effect=income:adjacent:100:Entertainment` | `computeBusinessStaffBuffs` | ✅ |
| 18 | `staff-delivery` | −50 adjacent purchases | `effect=purchase-discount:adjacent:50` | `computeAdjacentPurchaseDiscount` | ✅ |
| 19 | `staff-pr` | +15 rep own business | `effect=reputation:own:15` | `computeBusinessStaffBuffs` | ✅ |
| 20 | `staff-financial` | −100 upgrade cost own business | `upgradeCostDiscount=100` | `computeUpgradeCostDiscount` | ✅ |
| 21 | `staff-maintenance` | −50 incident rep (cluster) | `effect=incident-reputation:cluster:50` | `computeBusinessIncidentMitigation` | ✅ |
| 22 | `staff-investor` | free reroll/turn, 75% bias | `freeMarketRerollPerTurn=1`, `marketRelevanceBias=0.75` | `MainStreetMarketRefill` | ✅ |
| 23 | `staff-florist` | +30 coins adjacent Commerce/Culture | `effect=income:adjacent:30:Commerce\|Culture` | `computeBusinessStaffBuffs` | ✅ |
| 24 | `staff-baker` | +25 coins own business | `effect=income:own:25` | `computeBusinessStaffBuffs` | ✅ |
| 25 | `staff-chef` | +20% income own business | `effect=income:percent:20` | `computeBusinessStaffBuffs` | ✅ |
| 26 | `staff-mechanic` | +30 coins own business | `effect=income:own:30` | `computeBusinessStaffBuffs` | ✅ |
| 27 | `stf-ms-residential-community-gardener` (pack) | +1 hand slot | `handSlotsAdded=1` | `maxHandSize` | ✅ |

**Result:** 26/27 fully implemented. One gap: the Bookkeeper's −20% ongoing-cost effect has no backing data column, no parser support, and no engine consumer. This is tracked as a high-priority work item: **MS-0MW7D0LGL007PAUY** — *Bookkeeper -20% ongoing-cost staff effect is not implemented*.

## How the verdicts were determined

Each staff card was inspected for three things:

1. **Description text** — extracted from `src/card-data.csv` column `description`.
2. **Backing data** — checked for a corresponding data column in the same CSV row (e.g. `effect=…`, `handSlotsAdded`, `reputationPerTurn`, etc.).
3. **Engine consumer** — traced to the parser/buff/consumer that applies the effect at runtime:
   - `src/MainStreetCardsTemplates.ts` — `parseStaffEffect()` (effect spec parser)
   - `src/MainStreetStaffBuffs.ts` — `computeBusinessStaffBuffs()`, `computeBusinessIncidentMitigation()`, `computeIncidentFrequencyReduction()`, `computeAdjacentPurchaseDiscount()`, `computeUpgradeCostDiscount()` etc.
   - `src/MainStreetEngineCommands.ts` / `src/EngineActions.ts` — WeekStart, CompetitiveTurn, AdjacencyScoring, MainStreetMarketRefill, etc.

A staff card is **✅ implemented** when it has both a backing data column *and* a named engine consumer. It is **❌ gap** when neither exists.

## Regression guard

The guard in `tests/main-street/staff-cost-text-data-consistency.test.ts` (CG-0MTKMGL66004I0PC) ensures that every staff cost-reduction description is registered in a contract table. Cards with no backing data are registered with `column: null` and a note linking to their gap work item. This prevents future staff cards from silently introducing cost-reduction descriptions that do nothing.

## Reproducible re-run procedure

To re-run this audit against the current card data:

1. **Check CSV rows** — list all staff cards:
   ```bash
   grep '^staff,' src/card-data.csv
   ```
2. **Inspect backing data** — for each staff card, verify a data column exists in the same row:
   ```bash
   # Example: check the Bookkeeper specifically
   grep '^staff,staff-bookkeeper,' src/card-data.csv
   ```
3. **Check effect spec parser** — verify `src/MainStreetCardsTemplates.ts::parseStaffEffect` handles the effect type:
   ```bash
   grep -n "parseStaffEffect" src/MainStreetCardsTemplates.ts
   ```
4. **Check buff consumers** — verify `src/MainStreetStaffBuffs.ts` contains the effect handler:
   ```bash
   grep -n "computeBusinessStaffBuffs\|computeBusinessIncidentMitigation\|computeIncidentFrequencyReduction\|computeAdjacentPurchaseDiscount\|computeUpgradeCostDiscount" src/MainStreetStaffBuffs.ts
   ```
5. **Check engine commands** — verify the relevant engine command files (e.g. `EngineActions.ts`, `MainStreetEngineCommands.ts`) consume the effect.
6. **Run the guard** — the automated guard will catch any new unregistered cost-reduction descriptions:
   ```bash
   npx vitest run tests/main-street/staff-cost-text-data-consistency.test.ts
   ```

If step 6 reports an unregistered cost-reduction description, that staff card is a new gap that should be investigated.
