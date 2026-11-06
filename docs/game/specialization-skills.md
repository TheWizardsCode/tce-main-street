# Main Street — Staff Specialization Skills: Balance Documentation

> Epic CG-0MT1CIWSD003VBPK · Tasks T1–T3 (tests), Implementation I1–I5, this doc (D1, CG-0MT4WXZPX0040SA4).
> Companion to the skill implementation in `src/MainStreetStaffSkills.ts`
> (catalog + assignment), `MainStreetStaffBuffs.ts` (pure buff math), and the wiring in
> `MainStreetAdjacency.ts` / `MainStreetEngine.ts` / `MainStreetMarket.ts`.
>
> The staff types that skill scope refers to are defined once in
> [the-build-gdd.md](the-build-gdd.md) (Appendix D.4, *Staff System*), and the
> per-card roster is in [card-catalog.md](card-catalog.md) § *Staff Cards*.
> This document does not re-define the types; it classifies the 16
> specialization skills against them.

## Overview

Every staff card in the applicant pool carries **1–3 specialization skills**, randomised **once
per game at start** and **locked for the full game** (established by CG-0MSTOATDU006UGAX). The
draw is **type-consistent**: business staff draw only business-scope skills and
management-company staff draw only management-company-scope skills, so a skill's scope always
matches the card that holds it (see § *Cross-type assignments — gap closed* below for the shipped
gate and assignment). Within its own type the draw is still **disconnected from the staff
member's nominal job** — a *Chef* can hold Networker or Sales Champion — which is what keeps the
roster varied. The Town Gossip peek ability (CG-0MSXOW6GN008ZSMN) is a management-company-scope
skill, so it is a fixed **baseline skill on every management-company card**.

Skills sit on top of the two staff types rather than beside them. A skill's **scope** decides
which type can realise it, because the two staff types have different scopes of effect
(GDD D.4.1):

- **Business staff** — employed at one business (`employedAtSlot`); effects resolve per business,
  on the employing business and (where the role says so) its 8-way neighbours. Never street-wide.
- **Management-company staff** — employed by the player (the management company); effects resolve
  against the player and the turn: hand, actions, market, incident insight and street-wide
  economy. They never touch an individual business's income or reputation.

So **per-business skills are business-staff specialization effects**, and **street-wide or
player-scope skills are management-company staff effects**. The runtime determinant is
**assignment**, not a skill flag: a member carrying an `employedAtSlot` is business staff, and a
member with no `employedAtSlot` is management-company staff (GDD D.4.2 and D.4.8).

## The 16 skills by staff type

The catalog keeps its original four categories — 5 income-boost, 4 reputation-boost, 3
cost-reduction and 4 incident-mitigation skills — and splits **8 business-staff skills** and
**8 management-company skills** by scope:

| Skill | Name | Category | Effect (magnitude and direction) | Scope | Staff type |
|---|---|---|---|---|---|
| `skill-networker` | Networker | Income Boost | **+20 coins/turn** from each adjacent matching-synergy business | Its own business's 8-way neighbours | Business |
| `skill-chef` | Chef de Cuisine | Income Boost | **+20% coin income** | Its own business, when it is Food | Business |
| `skill-dj` | DJ | Income Boost | **+20% coin income** | Its own business, when it is Entertainment | Business |
| `skill-sales-champion` | Sales Champion | Income Boost | **+50 coins/turn** | Its own business, when it is Commerce | Business |
| `skill-tech-guru` | Tech Guru | Income Boost | **+1 synergy range** (links with businesses up to 2 slots away) | Its own business, when it is Entertainment | Business |
| `skill-community-builder` | Community Builder | Reputation Boost | **+10 reputation/turn** | Its own business | Business |
| `skill-pr-strategist` | PR Strategist | Reputation Boost | **+15 reputation/turn** | Its own business, when it is Service | Business |
| `skill-operations-manager` | Operations Manager | Cost Reduction | **−50 coins** on the employing member's salary (floored at 0) | Its own business's staffing cost | Business |
| `skill-town-gossip` | Town Gossip | Reputation Boost | **Reveals the top incident-deck card** (peek) once per turn (baseline skill on every card) | Player (incident insight) | Management-company |
| `skill-brand-ambassador` | Brand Ambassador | Reputation Boost | **+50% reputation gain** from incidents and investments | Player (event-source gains) | Management-company |
| `skill-cost-cutter` | Cost Cutter | Cost Reduction | **−15% ongoing costs** for staff, community-space and business costs (flagged for extra balance testing) | Street-wide economy | Management-company |
| `skill-negotiator` | Negotiator | Cost Reduction | **−100 coins** on a market refresh | Player (market) | Management-company |
| `skill-quality-inspector` | Quality Inspector | Incident Mitigation | **−30% coin damage** from incidents | Street-wide incident | Management-company |
| `skill-risk-manager` | Risk Manager | Incident Mitigation | **−15% incident probability** (deterministic per-turn avert) | Street-wide incident | Management-company |
| `skill-security-consultant` | Security Consultant | Incident Mitigation | **Immunity to theft/loss incidents** | Street-wide incident | Management-company |
| `skill-compliance` | Compliance Officer | Incident Mitigation | **−50 incident reputation damage** (floored at 0) | Street-wide incident | Management-company |

**Reading the table.** "Its own business" means the business recorded in the employing member's
`employedAtSlot`; "adjacent" means its 8-way neighbours. "Street-wide" means the effect resolves
once against the player's turn (incident draw, ongoing-cost deduction) and cannot be attributed to
a single business. Magnitudes are the reference values the balance pass is run against; the
per-skill capability (which effect each skill applies) is unchanged by this reconciliation.

### Per-business skills — business-staff specialization effects

The eight business-staff skills are exactly the skills whose effect can be attributed to one
business: **Networker**, **Chef de Cuisine**, **DJ**, **Sales Champion**, **Tech Guru**,
**Community Builder**, **PR Strategist** and **Operations Manager**. All five income-boost skills
are in this group, because an income boost is inherently an effect on a business's own income —
three of them (Chef/DJ/Sales Champion) applying only when the employing business is of the matching
type, and the other two (Networker/Tech Guru) acting through the employing business's adjacency and
synergy range. Community Builder and PR Strategist add reputation per turn to the employing
business (PR Strategist only when it is Service), and Operations Manager reduces the employing
member's salary, i.e. the part of the business's operating cost that its staff represents.

A business-staff skill therefore **never** resolves against another business, the player's hand,
the action budget, the market or a street-wide incident, which is the GDD D.4.8 invariant that
business-staff effects resolve only against the employing business or its 8-way neighbours.

### Player- and street-scope skills — management-company staff effects

The eight management-company skills are exactly the skills whose effect cannot be attributed to
one business: **Town Gossip**, **Brand Ambassador**, **Cost Cutter**, **Negotiator**,
**Quality Inspector**, **Risk Manager**, **Security Consultant** and **Compliance Officer**. All
four incident-mitigation skills are in this group — the incident is drawn and resolved once for the
player's turn, so its coin damage, reputation damage, probability and theft immunity are
player-scoped mitigations, not per-business buffs. Cost Cutter reduces all three ongoing-cost
families (staff, community space and business hand/grid costs) once, street-wide; Negotiator
reduces the player's market-refresh price; Brand Ambassador multiplies reputation gained from
incidents and investments; and the baseline Town Gossip is a player information effect (a peek at
the incident deck).

A management-company skill therefore **never** changes an individual business's income or
reputation, which is the GDD D.4.8 invariant that a management-company buff resolves against the
player. The Lookout's peek (GDD D.4.4) and the Town Gossip baseline are the same player-scope
effect delivered by a staff ability and by a baseline skill respectively.

## Stacking constraints (AC3/AC4)

Stacking is **per staff member** and **type-neutral**: the caps apply identically to a business
staff member and to a management-company staff member, and they never aggregate across a business
or across the street. No single staff member may hold **more than 1 income-boost skill AND more
than 1 reputation-boost skill** simultaneously (beyond the fixed Town Gossip baseline, which is
exempt — it is an informational peek, not a stacking boost). Cost-reduction and incident-mitigation
skills stack freely within the scope their staff type allows.

- **Income cap — at most 1 income-boost skill per member.** All income-boost skills are
  business-scope, so this cap only ever binds a business-staff member, and it caps that member's
  contribution to its own business. A business employs at most `max(1, level + 1)` members
  (GDD D.4.2), and the per-business cap is therefore bounded by employment capacity times one
  income skill each — never by "one income skill per business".
- **Reputation cap — at most 1 reputation-boost skill per member.** The baseline Town Gossip is
  **exempt** from this cap: it is a fixed informational peek, not a stacking reputation boost, and
  exempting it keeps the reputation pool reachable. Under the two-type model the cap is also
  scope-consistent: a business-staff member can hold at most one of Community Builder / PR
  Strategist (both business-scope), while Brand Ambassador is a management-company skill and so is
  never counted against a business member's cap — it is a player-level multiplier held by a
  management-company member.
- **Cost-reduction and incident-mitigation skills stack freely.** Cost Cutter / Negotiator
  (management-company) and Operations Manager (business) are different scopes and add
  independently. The incident-mitigation skills stack freely **across the company roster**:
  each management-company member's mitigation adds to the street-wide incident resolution, and no
  business-staff member contributes one under the two-type model.
- **Scope does not change the cap.** Assigning a skill is unchanged: 1–3 locked skills per staff
  card at game start, drawn from the pool that matches the card's staff type (business staff draw
  only business-scope skills; management-company staff draw only management-company-scope
  skills). What the two-type model adds is that a skill can only take effect from a member whose
  type matches the skill's scope — and the shipped assignment guarantees the two agree, so a
  locked roster can no longer hold an effect its holder could never realise.

This keeps the original anti-compounding intent (a member can still stack one income buff + one
cost reduction + one incident mitigation, but never two income boosts or two reputation boosts)
while making it explainable in the GDD's two-type vocabulary.

## Cross-type assignments — gap closed

The cross-type **gap is closed** by MS-0MW3LTMHT001PRDT: both halves of the reconciliation
follow-up this document used to record are shipped, and the shipped behaviour now matches the
two-type model described above.

- **Scope gate — behavioural (MS-0MW4MSNWR00123OZ).** A skill takes effect only from a member
  whose type matches the skill's scope. The gate lives in the aggregation helpers of
  `src/MainStreetStaffBuffs.ts` — the single place every consumer reads skills from — so no
  consumer needs per-effect special-casing: `getStreetScopeSkills` (and its state-level wrapper
  `getEmployedSpecializationSkills`) reads **management-company members only**, and
  `getBusinessScopeSkills` (wrapped per slot by `getEmployedSpecializationSkillsForBusiness`)
  reads business-scope skills from the members employed at that business. `getSalaryScopeSkills`
  gates the Operations Manager salary discount to the charging member's own business-staff scope.
- **Type-consistent assignment — deterministic (MS-0MW4MSNMJ006E9JH).** `assignSkillsToApplicant`
  takes the member's staff type — `staffCardScope` derives it from `employedAtSlot`, or from the
  template markers for a card that is not employed yet — and draws only from the catalog entries
  whose `scope` matches. Business staff never draw a management-company-scope skill, and the Town
  Gossip baseline is added only to management-company cards. The draw stays on the dedicated
  `createSeededRng(numericSeed ^ 0x5eed)` stream with the same per-draw call order, so
  same-seed ⇒ same game still holds.

Two consequences are worth stating explicitly, because the interim behaviour did the opposite:

- A **management-company-scope skill held by business staff** (Cost Cutter, Negotiator, Brand
  Ambassador, the four incident-mitigation skills, the Town Gossip baseline) is **inert**: it is
  filtered out of the street-wide aggregate, so it cannot leak a player/street-scope effect.
- A **business-scope skill held by a management-company member** (Chef, DJ, Networker, …) is
  likewise **inert**: the per-business folds only ever see business-scope skills from the members
  employed at that business, so a member with no `employedAtSlot` contributes no per-business
  buff.

Cross-type holdings can therefore still exist — a legacy save or a hand-built fixture can carry
any id on any member, because skills persist as stable id arrays — and they are harmless by
construction: the gate is enforced where the effects are aggregated, not only where the skills
are assigned.

## Street-wide and player-scope effects — flagged for additional testing ⚠️

- **Cost Cutter (−15% street-wide ongoing costs)** is the only skill that scales with *every*
  earned card (staff salaries, community-space costs, and business hand/grid costs all deduct
  less). It is a **management-company** effect, so the staff-type scope gate means only
  management-company staff can deliver it, and it is **flagged for extra balance testing**; the
  income/reputation per-business buffs are naturally bounded by the street's business count.
- **Risk Manager (−15% incident probability)** is modelled as a per-turn incident draw aversion
  (see wiring notes); its effect compounding with other management-company mitigation skills
  should be exercise-tested via `staff-skill-buff-wiring.test.ts` (I4).

## Wiring notes (how buffs reach the engine)

- **Per-business folding (business staff).** `applyIncome` folds per-business income and
  reputation buffs over the **cached** `currentIncome` / `currentReputationPerTurn` values without
  mutating them — the adjacency caching contract (CG-0MSVYPEZ90085SHE) is preserved and
  hiring/editing staff never leaves stale caches. The fold is fed by the business-scope skills of
  the members employed at that slot (`getEmployedSpecializationSkillsForBusiness`, which applies
  `getBusinessScopeSkills`), so a Chef employed at one Food business never buffs another Food
  business elsewhere on the street, and management-company members (no `employedAtSlot`)
  contribute nothing to it.
- **Per-business formula:** `buffed = cachedIncome × (1 + percent) + flat`; per-turn reputation
  adds `flat` per placed business. Percent applies to the business's income including synergy; no
  interaction terms between skills (purely additive — T3 tests enforce no runaway compounding).
- **Per-business card abilities (the staff card, not the skill).** A business-staff card may also
  carry a card-level effect spec in its `effect` column (`income`, `reputation`, `synergy-range`,
  `purchase-discount`, `incident-*`); it resolves per business through
  `computeBusinessStaffBuffs` / `computeBusinessIncidentMitigation` — `own` effects land on the
  employing business, `adjacent` effects on its 8-way neighbours, never street-wide (GDD
  D.4.3/D.4.8, MS-0MW3JXF6U00753LB). Card abilities and specialization skills are independent
  systems and compose additively.
- **Street-wide / player folds (management-company staff).** Ongoing-cost reduction, incident
  mitigation, the reputation-gain multiplier and the refresh discount are computed from the
  street-wide skill aggregate (`getEmployedSpecializationSkills`, which applies
  `getStreetScopeSkills`), so these folds read management-company members only — a business-staff
  member's management-company-scope skill never reaches them. The Operations Manager's salary
  discount is a business-staff effect: each charging member's discount is read from its own
  business-scope skills (`getSalaryScopeSkills`), so it discounts only that member's salary at the
  employing business and a management-company member's cross-type Operations Manager is inert.
- **Cost reductions:** Cost Cutter applies to **all three** ongoing-cost families
  (staff/community-space/business) at end of turn; Operations Manager discounts **only its own
  member's** salary (a business-staff cost effect); Negotiator reduces `refreshMarketCost` in
  addition to legacy `refreshCostDiscount` staff abilities (Group F); the Financial Advisor's
  `upgradeCostDiscount` reduces the upgrade cost of its employing business only
  (CG-0MTKMGL66004I0PC); the Accountant's `refreshCostDiscount` reduces `refreshMarketCost`
  street-wide, a player-scope field that belongs to management-company staff
  (CG-0MULWEEE8007J2TB). The two business-staff cost cards were re-scoped by the two-type
  redesign: the IT Specialist's former street-wide refresh discount is now +1 synergy range for
  its own business, and the Delivery Driver's former street-wide `purchaseCostDiscount` is now a
  placement-scoped adjacency discount — businesses placed 8-way adjacent to its own business cost
  50 less across every acquisition path (click, drag, deferred play-from-hand), discount applied
  to the base cost before any premium, floored at 0 (GDD D.4.3/D.4.8,
  card-catalog § *Staff Cards*, MS-0MW3JXF6U00753LB).
- **Incidents:** damage reductions and theft immunity apply to Incident-trigger events only (the
  incident is player-scope, so these are management-company effects); Brand Ambassador multiplies
  *positive* reputation deltas from both incidents and investments. Risk Manager averts a turn's
  incident draw with 15% probability (deterministic — consumes one main-RNG draw while employed;
  averted incidents stay in the deck).
- **Determinism (I3):** skill assignment uses a dedicated `createSeededRng(numericSeed ^ 0x5eed)`
  stream, leaving the main RNG stream (deck shuffles, market draws, challenges) untouched —
  same seed ⇒ same skills ⇒ same game. The type-consistent draw keeps that stream's per-draw call
  order, so restricting the candidate pool by staff type changed which skills a seed yields but
  not the stream's determinism.

## Serialization & compatibility

Skills persist as **stable id arrays** (`specializationSkillIds`) on staff cards; they survive
save → restore through `structuredClone`. `deserializeSkillIds` fails loudly on unknown ids
(SaveLoadStore versioning convention); engine buff gathering (`getEmployedSpecializationSkills`)
skips members with stale ids so a future save never breaks the income phase. Legacy saves
(members without the field) simply carry no skills.

The two-type model changes **no** persistence: the staff type is derived from the member's
`employedAtSlot`, so it never needs a stored field, and a skill id resolves to the same effect
regardless of who holds it (the holder's type decides whether that effect applies).

## Job-applicant flow & employment slots (CG-0MSTOATDU006UGAX)

> The applicant presentation (walk-on/walk-off UI) is implemented in
> `MainStreetRenderer.refreshApplicant()` + `MainStreetAnimator` walk tweens;
> scene wiring lives in `MainStreetTurnController.startTurnPhase()` (sets the
> `applicant` UI phase when a pending applicant arrives) and
> `MainStreetScene.onHireApplicant()` / `onDeclineApplicant()`. Engine rules
> are in `MainStreetEngine.ts`.

### Per-turn trigger

At WeekStart, after the market refill, `resolveStaffApplicant(state)` rolls a
chance of `min(reputationPerTurn + incomePerTurn, 15)%` via the seeded
`state.rng`. When it fires, it picks a deployed business with a free
employment slot (`getEmploymentCapacity(state, slot)` = `max(1, level + 1)`
slots; a business at level 0 has 1 slot) and draws an applicant card from the
staff pool (`state.decks.staff`). The card is stored as
`state.pendingApplicant = { card, targetSlotIndex }` and the scene switches to
its `applicant` UI phase. The trigger is suppressed in tutorial / headless
modes (`state.suppressApplicant`).

### Hire / decline / let-go

- **Hire** (`hireStaffApplicant`): pushes the member into `state.staffCards`
  with `employedAtSlot = targetSlotIndex`, costs **0 coins** and consumes **no
  action**. The member's passive specialization buff is folded into its
  business's income / reputation at the next income phase. Salary is an
  ongoing per-turn cost deducted alongside other staff / community-space
  costs (clamped at 0).
- **Decline** (`declineStaffApplicant`): clears `pendingApplicant` with no
  other effect; the declined card leaves the applicant pool.
- **End-of-turn auto-decline**: an unresolved applicant is auto-declined in
  `processEndOfTurn`, so ending the turn is never blocked.
- **Let-go** (`letGoStaffMember(state, idx)`): removes the member from
  `staffCards`, deducts **1 turn's salary** (clamped at 0 coins) and **1
  reputation**; buffs stop applying from the next income phase. It is
  reachable in play from the **Manage Card** dialog (`[ Lay off ]`, shown
  only when the street card employs somebody), which runs
  `letGoStaffCommand` through the undo stack
  (CG-0MTXLTIPF000KFUA).

### Where the applicant's type changes the flow

Per GDD D.4.1/D.4.2, the applicant's type decides the hire flow: a business-staff
applicant **chooses a destination business** (matching `allowedBusinessTypes`,
with a free employment slot) and may later be relocated for **1 action**; a
management-company applicant joins the company with no placement step and is
never placed or relocated. The walk-on flow above is the shipped business-staff
flow; the management-company branch is part of GDD D.4.2 and the
core-rules hire/relocate rules — see [the-build-gdd.md](the-build-gdd.md)
Appendix D.4 and [core-rules-and-mechanics.md](core-rules-and-mechanics.md) §
*Action Economy*.

### Scene & presentation contract (rule 8 compliant)

- The applicant is rendered face-up (staff SVG + skill chips) at the SLL
  `applicantOverlay` zone centre; the card walks on from the left
  (~1.0s tween, instant under reduced motion) with the deal SFX.
- **Hire** animates the card toward its target business slot (place SFX);
  **Decline** walks it off to the right (discard SFX); both are action-free
  and end with a full `refreshAll()`.
- All sounds route through `SoundManager` with shared `SFX_KEYS`
  (deal/place/discard) so settings mute/volume and reduced-motion are
  respected.

## Related docs

- [the-build-gdd.md](the-build-gdd.md) — Appendix D.4 *Staff System*: the two
  staff types, their roles and impacts, the gameplay outcomes and the
  implementation contract (D.4.8) this catalogue classifies against.
- [card-catalog.md](card-catalog.md) — the 26 shipped staff templates (with the
  two-type `Type` column), including the 12 role-themed specialization
  applicants and the Investor.
- `balancing-methodology.md` — the general balance pass methodology.
- Town Gossip peek: CG-0MSXOW6GN008ZSMN; Group F staff abilities: CG-0MSQJ7VL9009JHF4;
  ongoing per-turn costs: CG-0MSVYPEZ90085SHE.
