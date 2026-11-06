# Staff two-type model — cross-document consistency review

> Work item **MS-0MW2XMBD5006UV3N** (parent epic **MS-0MW20VBSZ003A01O**, *Staff impact*).
> Review performed after the staff redesign landed in the design docs
> (GDD Appendix D.4 rewritten by MS-0MW2XMA0Z007MZ6D, with the reconciliation
> children MS-0MW2XMAD2005MNQ4, MS-0MW2XMAOY005Y0DC, MS-0MW2XMB0P002D95K and the
> verification harness MS-0MW2XKTR50062OFL).

## What was reviewed

The model under review: staff are exactly **two types** — **business staff**
(employed at a single business, effects scoped to that business and, where the
card says so, its 8-way neighbours) and **management-company staff** (employed by
the player, effects player/turn-scoped). A member's type is determined by
assignment (`employedAtSlot`), never by a separate flag, and only
management-company staff grant hand capacity.

| Document | Verdict |
|---|---|
| `docs/game/the-build-gdd.md` (Appendix D.4, Glossary) | Consistent — two findings fixed |
| `docs/game/card-catalog.md` (§ *Staff Cards*) | Consistent — one finding fixed |
| `docs/game/core-rules-and-mechanics.md` (action economy, hand capacity, hire/relocate) | Consistent — one finding fixed |
| `docs/game/specialization-skills.md` (skill scope by staff type) | Consistent — no change needed |
| `docs/game/content-design-and-progression.md` (§1.4 Staff Cards) | **Stale** — rewritten |
| `docs/dev/prd-multi-use-card-economy.md` (§5 Staff Cards) | **Stale** — supersession note added |
| `src/README.md` (hand layout / `maxHandSize`) | **Stale** — corrected |
| `src/MainStreetCardsTypes.ts` (`StaffCard`) | **Stale code comment** — corrected |
| `README.md` (repository overview) | Consistent — references staff only as a card family |
| `docs/game/card-dimensions.md`, `card-diagrams.md`, `ux-visual-audio.md`, `playtest-scenarios.md` | Consistent — no statement about staff role or type |
| `core/` submodule (`core/README.md`, `core/docs/DEVELOPER.md`) | Out of this repository — see follow-ups |

## Method

1. Read Appendix D.4 end to end and compared its roles, deltas and contract
   (D.4.3, D.4.4, D.4.7, D.4.8) against the other three design documents.
2. Ran the mechanical check: `npm run validate:gdd` (`-- --json` for the
   machine-readable report) and the documentation guards in the unit suite
   (`tests/main-street/gdd-staff-consistency.test.ts`,
   `card-catalog-staff-types.test.ts`, `core-rules-staff-two-type.test.ts`,
   `investor-docs.test.ts`).
3. Verified every documented staff figure against the shipped templates in
   `src/card-data.csv` through the card model (`getStaffCardTemplates`,
   `CARD_TIER_MAP`) — name, cost, salary, tier, type and the 9/17 split.
4. Scanned the remaining documentation, READMEs and the `StaffCard` type for the
   superseded framing (staff as a hand-capacity purchase).

## Findings

| # | Document | Finding | Resolution |
|---|---|---|---|
| 1 | `content-design-and-progression.md` §1.4 | The section defined staff as “Staff cards expand hand capacity at an ongoing per-turn coin cost”, listed only 10 of the 26 templates and named no type — the superseded hand-capacity framing the GDD forbids. | Rewritten: two-type framing, a **Staff type** column on every ladder row, shipped-value note, and an explicit pointer to the 16 remaining business-staff cards in the catalogue. |
| 2 | `prd-multi-use-card-economy.md` §5 | The historical PRD still presented staff as a hand-capacity purchase and stated a lay-off rule (“removing random hand cards equal to `handSlotsAdded`”) that the GDD records as contradictory to the implementation. | Kept as a historical record, with a status note that retires the framing, states the implemented lay-off rule (one turn's salary plus 1 reputation) and links GDD D.4 and the catalogue. |
| 3 | `src/README.md` | Hand capacity documented as “growable via staff upgrade cards' `handSlotsAdded`” — wrong family (staff cards are not upgrade cards) and wrong scope (not every staff card grants slots). | Corrected to management-company-only growth, with the GDD pointer. |
| 4 | `src/MainStreetCardsTypes.ts` (`StaffCard`) | Doc comment described a staff card as “a Staff card that increases hand capacity”, contradicting the model the interface implements (`employedAtSlot`, per-business buffs). | Comment now states both types, the assignment determinant and the management-company-only hand-slot rule. |
| 5 | `card-catalog.md` § *Staff Cards* | The card-data marker for management-company staff (“at least one player-scope field”, including `refreshCostDiscount`/`taxAuditRate`) contradicted the catalogue's own roster: `staff-it` ships `refreshCostDiscount = 100` yet is business staff. | Marker narrowed to the two shipped markers the roster (and the checker) actually uses (`handSlotsAdded > 0`, `actionsPerTurn > 0`), with a note naming IT Specialist and Delivery Driver as recorded target deltas — not type markers. |
| 6 | `the-build-gdd.md` D.4.7 | Same loose gloss (“hand capacity, action points *or street-independent player benefits*”) implied the two business-staff cards with shipped street-wide fields were misclassified. | Gloss replaced by the deterministic two-marker rule plus a pointer to the D.4.3 deltas. |
| 7 | `the-build-gdd.md` D.4.5 | The worked comparison claimed “the same salary spent on a Manager” returns +1 action and +1 hand slot; the Manager's salary is 250 against the Barista's 50 (5×). | Comparison now states both salaries explicitly. |
| 8 | `core-rules-and-mechanics.md` §6.0 | The action budget documents the shipped `actionsPerTurn: 1` for all four action-granting cards without noting that the two-type target re-values the Executive to +2 actions/turn (and drops its hand slot). | Added a shipped-value-vs-target note pointing at GDD D.4.4/D.4.7 as the follow-up, leaving the shipped rule intact. |

## Deliberate non-changes

- **Historical PRDs** (`prd-milestone-*.md`, `prd-balance-process-and-tooling.md`)
  are records of what was designed at the time; they are not edited beyond a
  supersession pointer (finding 2), following the GDD's own convention of
  retaining historical statements with a status note.
- **Shipped card values** in the catalogue and the progression ladder keep the
  `src/card-data.csv` values; the target re-valuations (Assistant, Executive,
  Baker, Event Planner) and re-scopes (Delivery Driver, Security Guard,
  Maintenance Worker, Health & Safety Inspector, Marketing Consultant,
  PR Officer, IT Specialist) remain implementation follow-ups recorded in GDD
  D.4.3/D.4.7 and the catalogue's “Shipped effects vs. the two-type target”
  note. The documentation states both the shipped and the target behaviour
  wherever they differ.
- **`src/MainStreetStateTypes.ts`** describes `staffCards` as “active staff cards
  providing hand capacity bonuses”; that is a field-level comment on the
  per-seat hand-capacity bookkeeping, not a definition of the staff system, and
  the field genuinely is the hand-capacity carrier. Left unchanged.

## Follow-ups (not implemented here)

1. **Cross-repository statement.** `core/README.md` (the Tableau Card Engine
   submodule) still describes Main Street as “staff cards expand hand capacity
   with ongoing costs”. That file lives in the engine repository
   (`TheWizardsCode/Tableau-Card-Engine`), so it needs a work item there.
2. **Engine deltas.** The per-card re-scopes and re-valuations above are
   behavioural work items — they are documented, not implemented, by the
   redesign. The specialization-skill half of this follow-up **has since
   shipped**: the staff-type scope gate (MS-0MW4MSNWR00123OZ) and the
   type-consistent assignment (MS-0MW4MSNMJ006E9JH), under
   MS-0MW3LTMHT001PRDT, are recorded as closed in
   `specialization-skills.md` (§ *Cross-type assignments — gap closed*).

## Re-running the checks

```bash
npm run validate:gdd          # human-readable
npm run validate:gdd -- --json  # machine-readable
npx vitest run --project unit tests/main-street/staff-two-type-surrounding-docs.test.ts
```

`tests/main-street/staff-two-type-surrounding-docs.test.ts` guards the findings
in this review: it asserts the progression ladder's types, costs, salaries and
tiers against `src/card-data.csv`, requires the PRD supersession note, and fails
if the superseded hand-capacity framing returns to any of the reviewed
documents.
