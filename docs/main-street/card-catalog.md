# Main Street: Card Catalog

> **Source of truth:** `src/card-data.csv` (CSV) — loaded by `MainStreetCards.ts` at build time (work item CG-0MR6ZR23J006ZDNZ)
> **Last updated:** Annual calendar — week-gated seasonal/holiday events (CG-0MTT0K9RX0004QTE)

This document lists every card template in the Main Street card pool, organised by family (Business, Event, Upgrade, Community Space, Staff). Each entry includes all gameplay-relevant fields and a short design rationale.

Card templates are stored as rows in `card-data.csv` and parsed at build time by `MainStreetCards.ts`. To add cards, edit the CSV and regenerate metadata (see guidance below).

**Deck sizes (default copies):**

| Family        | Templates | Copies each | Total cards |
|---------------|-----------|-------------|-------------|
| Business      | 31        | 3           | 93          |
| Event         | 71        | 3           | 213         |
| Upgrade       | 39        | 2           | 78          |
| Community Space | 8       | 3           | 24          |
| Staff         | 26        | 1           | 26          |

**Synergy types:** Food, Culture, Commerce, Service (M2), Entertainment (M2), Health (M2)

## Expansion summary (baseline vs current)

| Snapshot | Business | Event | Upgrade | Community Space | Staff | Total templates |
|---|---:|---:|---:|---:|---:|---:|
| Tier 1 baseline (`docs/main-street/card-catalog-baseline.json`) | 4 | 4 | 4 | 2 | 1 | 15 |
| Current catalog (`card-data.csv`) | 31 | 71 | 39 | 8 | 26 | 175 |
| Net increase | +27 | +67 | +35 | +6 | +25 | +160 |

- 2x target from baseline: `>= 30` templates
- Current total: `175` templates (`11.7x` baseline)
- Business family grew from 18 to 30 with the Group A expansion (CG-0MSQJ1XIB0004QVN):
  12 new cards including the first Health bridge cards (Juice Bar, Yoga Studio,
  Physiotherapist), mid-tier (T2/T3) singles, and the T5 Grand Hotel flagship.
  The producer-added Charity Shop (MS-0MUAYBAHW007RMSL) brings the family to 31.
- Community Space grew from 2 to 8 with the Group B expansion (CG-0MSQJ210I00491ZZ):
  6 new reputation assets across four synergies (Playground, Community Garden,
  Town Fountain, Health Kiosk, Community Shelter, Public Art), including the
  first ongoing-cost community-space bridge card (Public Art).
- Event family grew from 37 to 45 with the Group C expansion (CG-0MSQJ244M0055X7S):
  8 new Investment events (investment events 13 → 21) covering every synergy,
  plus two NEW duration effect types — positive `income-multiplier` (Tourist
  Season 1.15×/3 turns) and `rep-multiplier` (Community Renovation 1.2×/4 turns).
- Incident events grew from 24 to 34 with the Group D expansion (CG-0MSQJ7QLM0076FTD),
  10 new incidents (4 good / 3 bad / 3 neutral under the streak system's net-delta
  formula) covering under-served synergies, including the duration incident
  Labor Shortage (income-multiplier 0.9×/3 turns).
- Graffiti Art (evt-graffiti-art, CG-0MSRC9UR9006FBXC) adds a good incident —
  a reputation-only positive counterpart to Graffiti (+100 reputation to all
  businesses, no coins), raising incidents to 35 and event templates to 56.
- Upgrades grew from 27 to 39 with the Group E expansion (CG-0MSQJ7SYD008U3EE):
  12 new upgrades covering every Group A business and Group B community space
  (targets raised to maxLevel 1 so the upgrades are applicable), including
  reputation-bonus upgrade variants (Tea Lounge, Adventure Park, Orchard,
  Grand Fountain, Health Center).
- Staff grew from 3 to 7 with the Group F expansion (CG-0MSQJ7VL9009JHF4):
  Apprentice (budget) and Executive (+4 slots premium) cost points, plus two
  NEW ability mechanics — the Socialite's +10 rep/turn and the Accountant's
  market-refresh discount of 100 (StaffCard optional ability fields). The
  Financial Advisor's per-business upgrade discount of 100 is implemented via
  the `upgradeCostDiscount` field (CG-0MTKMGL66004I0PC); the IT Specialist
  (`refreshCostDiscount = 100`) and Delivery Driver (`purchaseCostDiscount = 50`)
  cost-reduction descriptions are now data-backed and fully implemented
  (CG-0MUMCVH3N007KT1M).
- Staff gained the market-shaping **Investor** (`staff-investor`, MS-0MTISBYLS009936W):
  while employed at a business it grants one **coin-free, action-free market
  re-roll per turn**, biased **75%** toward the hosting business's synergy types
  (new `freeMarketRerollPerTurn` flag + `marketRelevanceBias = 0.75` column);
  the free re-roll advances the paid escalation counter
  (MS-0MTR6ZRF5007PWNZ), and relocating **any** employed staff member now costs
  1 action point (MS-0MUOSUNYR0073SI1).
- Non-baseline card IDs are tracked in `docs/main-street/expanded-card-manifest.json`

### Guidance: adding more cards safely

1. Add rows to `src/card-data.csv` (the game repo root; post-extraction path) using the correct family column value (`business`, `event`, `upgrade`, `community-space`, or `staff`).
2. Regenerate metadata artifacts:
   - `npx tsx scripts/generate-card-csv.ts` — regenerates `card-data.csv` from TS (only if editing TS directly; normally edit CSV)
   - `npx tsx scripts/generate-main-street-catalog-baseline.ts`
   - `npx vite-node scripts/generate-main-street-expanded-card-manifest.ts`
     _(uses Vite-aware ESM loader because it imports deck-building functions from `MainStreetCards.ts`)_
3. Regenerate placeholder art:
   - `node scripts/generate-main-street-card-svgs.mjs`
4. Run regression tests:
   - `npx vitest run --project unit tests/main-street/expanded-card-pool.test.ts`
   - `npx vitest run --project unit tests/main-street/card-manifest.test.ts tests/main-street/card-svg-coverage.test.ts`

---

## Business Cards

Business cards are placed on the 10-slot street grid. Each generates base income plus synergy bonuses from adjacent businesses sharing a synergy type.

> **Payback rebalance (MS-0MUQ50I1Y000B6L3):** business `baseIncome` is derived from a
> cost-graded **net payback** target (`cost ÷ (baseIncome − ongoingCost)`), averaging
> ~4.87 turns across the 30 income businesses (cheap ~3.5 → flagship ~7.0). See
> [balancing-methodology.md](balancing-methodology.md) § Business payback rebalance and
> [payback-rebalance-evidence.md](payback-rebalance-evidence.md).

> **Ongoing cost field (CG-0MSVYPEZ90085SHE):** Business cards carry an `ongoingCost` CSV column value (column 29; col 28 is `newDisplayName` — the intake brief's "column 28" was a miscount) that is deducted from coins every IncomePhase — whether the card is placed on the street grid **or held in hand** (hand-held cards incur no ongoing cost per CG-0MTC31LN3000UHDY) — alongside staff and community-space costs. Deductions are clamped at 0 coins and logged. Cards with an empty `ongoingCost` CSV value default to 0. Per-card values are populated in `card-data.csv` using the balance guideline **¼ purchase price, min 25** (e.g. Teahouse costs 7 → 175 coins/turn).

### M1 Business Templates (4)

| ID | Name | Cost | Income | Synergy | Upgrade Path | Description | Rationale |
|----|------|------|--------|---------|--------------|-------------|-----------|
| `biz-bakery` | Bakery | 300 | 161 (rep +20/turn, ongoing −75/turn) | Food | Bakery | Warm pastries. Gains 50% of base income per adjacent Food business (scales with difficulty). | Affordable Food starter. |
| `biz-diner` | Diner | 300 | 161 (rep +20/turn, ongoing −75/turn) | Food | Diner | Quick meals. Gains 50% of base income per adjacent Food business (scales with difficulty). | Higher-cost, higher-income Food option. |
| `biz-bookshop` | Bookshop | 300 | 161 (rep +20/turn, ongoing −75/turn) | Culture | Bookshop | Sells books. Gains 50% of base income per adjacent Culture business (scales with difficulty). | Mid-cost Culture business. |
| `biz-hardware` | Hardware Store | 300 | 161 (rep +20/turn, ongoing −75/turn) | Service | Hardware Store | Supplies tools. Gains 50% of base income per adjacent Service business (scales with difficulty). | Retagged Commerce → Service (CG-0MT3IPFSF005KEFB): tool supply is a Service; gives T2 a second synergy type (Commerce 2 / Service 1). |

Park has been reclassified as a **Community Space** card (see below).

### M2 Business Templates (12)

#### Commerce (filling the gap)

| ID | Name | Cost | Income | Synergy | Upgrade Path | Description | Rationale |
|----|------|------|--------|---------|--------------|-------------|-----------|
| `biz-pawnshop` | Pawn Shop | 200 | 132 (rep −10/turn, ongoing −75/turn) | Commerce | Pawn Shop | Second-hand goods. Does not provide or receive synergy bonuses. | Budget Commerce option; drains reputation each turn. |
| `biz-boutique` | Boutique | 300 | 161 (rep +20/turn, ongoing −75/turn) | Commerce | Boutique | Curated fashion. Gains 50% of base income per adjacent Commerce business (scales with difficulty). | Mid-tier Commerce; distinct flavour from Hardware Store. |

#### Service (new synergy type)

| ID | Name | Cost | Income | Synergy | Upgrade Path | Description | Rationale |
|----|------|------|--------|---------|--------------|-------------|-----------|
| `biz-laundromat` | Laundromat | 400 | 214 (rep +20/turn, ongoing −100/turn) | Service | Laundromat | Self-serve laundry. Gains 50% of base income per adjacent Service business (scales with difficulty). | Budget Service entry point. |
| `biz-barbershop` | Barbershop | 500 | 225 (rep +32/turn, ongoing −125/turn) | Service | Barbershop | Classic cuts. Gains 100% of base income per adjacent Service business (scales with difficulty). | Pairs with Laundromat for early Service cluster. |

#### Health (new synergy type)

| ID | Name | Cost | Income | Synergy | Upgrade Path | Description | Rationale |
|----|------|------|--------|---------|--------------|-------------|-----------|
| `biz-clinic` | Clinic | 900 | 0 (rep +160/turn, ongoing −50/turn) | Health | Clinic | Walk-in medical care. Provides +160 rep/turn. | Non-profit community health provider; reputation instead of income. |
| `biz-private-clinic` | Private Clinic | 1400 | 559 (rep +100/turn, ongoing −350/turn) | Health | Private Clinic | Private medical practice. Gains 50% of base income per adjacent Health business (scales with difficulty). | For-profit counterpart to Clinic; income-focused. |
| `biz-pharmacy` | Pharmacy | 700 | 315 (rep +40/turn, ongoing −175/turn) | Health | — | Provides essential medications. Gains 50% of base income per adjacent Health business (scales with difficulty). | Standalone Health card (no upgrade). |

#### Entertainment (new synergy type)

| ID | Name | Cost | Income | Synergy | Upgrade Path | Description | Rationale |
|----|------|------|--------|---------|--------------|-------------|-----------|
| `biz-arcade` | Arcade | 400 | 214 (rep +20/turn, ongoing −100/turn) | Entertainment | Arcade | Retro fun for all ages. Gains 50% of base income per adjacent Entertainment business (scales with difficulty). | No longer a Service bridge (CG-0MT5VZJLS000B8KI): an arcade is a family entertainment venue, matching Cinema/Music Store's standard Entertainment template; T3 spans two types via the retiered Community Shelter. |
| `biz-cinema` | Cinema | 500 | 225 (rep +32/turn, ongoing −125/turn) | Entertainment | Cinema | Latest films. Gains 50% of base income per adjacent Entertainment business (scales with difficulty). | Premium Entertainment; anchors the type. |

#### Multi-Synergy Bridge Cards

Bridge cards belong to two synergy types simultaneously, enabling cross-type adjacency bonuses and strategic placement decisions.

| ID | Name | Cost | Income | Synergy | Upgrade Path | Description | Rationale |
|----|------|------|--------|---------|--------------|-------------|-----------|
| `biz-cafe` | Cafe | 700 | 315 (rep +40/turn, ongoing −175/turn) | Food + Culture | Cafe | Coffee and conversation. | Bridges the two most common M1 types. |
| `biz-food-truck` | Food Truck | 400 | 214 (rep +20/turn, ongoing −100/turn) | Food + Entertainment | Food Truck | Street eats with flair. | Cheapest bridge card; low risk, low reward. |
| `biz-gallery` | Art Gallery | 1400 | 559 (rep +100/turn, ongoing −350/turn) | Culture + Entertainment | Art Gallery | Showcases local artists. | Connects M1 Culture with new Entertainment. |
| `biz-spa` | Day Spa | 1400 | 559 (rep +100/turn, ongoing −350/turn) | Service + Entertainment | Day Spa | Relaxation and pampering. | Premium bridge; high synergy potential across 2 new types. |
| `biz-florist` | Flower Shop | 500 | 225 (rep +40/turn, ongoing −125/turn) | Commerce + Culture | Flower Shop | Arrangements for every occasion. | Commerce–Culture bridge at tier-5 income parity (CG-0MT6EQSPW002E7RC). |

### M3 Business Templates (12) — Group A expansion (CG-0MSQJ1XIB0004QVN)

Adds the first **Health bridge cards**, mid-tier (T2/T3) singles across every synergy, and a T5 flagship.

#### Health bridges (new)

| ID | Name | Cost | Income | Synergy | Tier | Rep/turn | Description | Rationale |
|----|------|------|--------|---------|------|----------|-------------|-----------|
| `biz-juice-bar` | Juice Bar | 500 | 225 (rep +32/turn, ongoing −125/turn) | Food + Health | 3 | 32 | Fresh juices and smoothies. Bridges Food and Health synergies. | First Health bridge; connects the existing Food cluster to Health. |
| `biz-yoga-studio` | Yoga Studio | 800 | 345 (rep +48/turn, ongoing −200/turn) | Culture + Health | 4 | 48 | Calm practice space for mind and body. Bridges Culture and Health synergies. | Culture–Health bridge; mid-tier wellness option. |
| `biz-physio` | Physiotherapist | 1000 | 432 (rep +60/turn, ongoing −250/turn) | Health + Service | 4 | 60 | Recovery and rehabilitation care. Bridges Health and Service synergies. Provides +60 reputation per turn. | Health–Service bridge with a small reputation perk. |

#### Singles (mid-tier depth)

| ID | Name | Cost | Income | Synergy | Tier | Rep/turn | Description | Rationale |
|----|------|------|--------|---------|------|----------|-------------|-----------|
| `biz-tailor` | Tailor | 500 | 225 (rep +32/turn, ongoing −125/turn) | Service | 2 | 32 | Custom tailoring and repairs. Gains 50% of base income per adjacent Service business. | Mid Service single; smooths T2. |
| `biz-gym` | Gym | 800 | 345 (rep +48/turn, ongoing −200/turn) | Health | 5 | 48 | Fitness training for the whole street. Gains 50% of base income per adjacent Health business. | Health single; T5 anchor (rebalanced from T3, CG-0MT2WU0CX005Z143). |
| `biz-dentist` | Dentist | 1200 | 485 (rep +80/turn, ongoing −300/turn) | Health | 5 | 80 | Smiles for the whole street. Gains 50% of base income per adjacent Health business. | Premium Health single (rebalanced from T4). |
| `biz-toy-store` | Toy Store | 500 | 225 (rep +32/turn, ongoing −125/turn) | Commerce | 3 | 32 | Toys and games for young shoppers. Gains 50% of base income per adjacent Commerce business. | Commerce depth at T3 (rebalanced from T2). |
| `biz-music-store` | Music Store | 800 | 345 (rep +48/turn, ongoing −200/turn) | Entertainment | 5 | 48 | Records and instruments for every taste. Gains 50% of base income per adjacent Entertainment business. | Entertainment depth at T5 (rebalanced from T3). |
| `biz-delicatessen` | Delicatessen | 500 | 225 (rep +32/turn, ongoing −125/turn) | Food | 2 | 32 | Fine meats and cheeses. Gains 50% of base income per adjacent Food business. | Food depth at T2. |
| `biz-craft-shop` | Craft Shop | 500 | 225 (rep +32/turn, ongoing −125/turn) | Culture | 2 | 32 | Handmade goods by local makers. Gains 50% of base income per adjacent Culture business. | Culture single (only Bookshop existed before). |

#### Flagship

| ID | Name | Cost | Income | Synergy | Tier | Rep/turn | Description | Rationale |
|----|------|------|--------|---------|------|----------|-------------|-----------|
| `biz-hotel` | Grand Hotel | 1600 | 629 (rep +120/turn, ongoing −400/turn) | Service | 5 | 120 | Premier lodging on Main Street. Gains 50% of base income per adjacent Service business. Provides +120 reputation per turn. | T5 flagship; highest income in the pool. Cost exceeds the flagship band's 14 cap to reflect premium positioning (documented balance rationale). |
| `biz-teahouse` | Teahouse | 700 | 315 (rep +40/turn, ongoing −175/turn) | Food + Culture | 3 | 40 | Loose-leaf teas and quiet corners. Bridges Food and Culture synergies. | Second Food–Culture bridge (alongside Cafe). |

### Producer-Added Business Templates (1) — Charity Shop (MS-0MUAYBAHW007RMSL)

A tier-2, standalone Culture business added by the producer: a low-cost,
reputation-leaning Culture card that trades a modest income for a steady
reputation trickle (1.5 gross income + 0.6 reputation per turn at the design
scale).

| ID | Name | Cost | Income | Synergy | Tier | Rep/turn | Description | Rationale |
|----|------|------|--------|---------|------|----------|-------------|-----------|
| `biz-charity-shop` | Charity Shop | 300 | 150 (rep +60/turn, ongoing −75/turn) | Culture | 2 | 60 | Sells donated goods. Provides +60 reputation per turn. Gains 50% of base income per adjacent Culture business (scales with difficulty). | Early reputation-leaning Culture single. The producer-specified cost of 300 is a deliberate manual override of the balance curve — see `balancing-methodology.md` § Special Cases. |

---

## Community Space Cards

Community space cards are a separate card family (`community-space`) placed on the street grid alongside business cards.
They share the same mechanical behavior as businesses (grid placement, synergy bonuses, upgrade path, level tracking)
but are classified differently for thematic clarity. Community space cards appear in the **Development** market row
alongside business cards.

| ID | Name | Cost | Income | Synergy | Upgrade Path | Description | Rationale |
|----|------|------|--------|---------|--------------|-------------|-----------|
| `cs-park` | Park | 150 | 0 | Entertainment | Park | Offers leisure space. Costs 40 coins per turn to run. Gains 50% of base income per adjacent Entertainment business or community space (scales with difficulty). | Reclassified from M1 Business; retagged Culture → Entertainment (CG-0MT3IPFSF005KEFB) so T1's spread is Culture 2 / Food 2 / Service 1 / Entertainment 1; cheapest community space. Running cost 40/turn (CG-0MU9NW9EP003B1AK) so Park-spam carries a real per-turn drain. Cost re-priced 300 → 150 (MS-0MUR9IN7L0004TO5) to reflect its zero reputation and negative net value. |
| `cs-library` | Library | 400 | 0 | Culture | Library | Quiet community space for reading and learning. Costs 25 coins/turn to run; +40 rep/turn. | Reputation asset: no income; small running cost for steady reputation. Full Culture synergy participation (Park model) — contributes to adjacent Culture businesses' synergy and receives rep synergy from rep-bonus neighbours (reversed by CG-0MSKS963N000ZSTU). Cost re-priced 700 → 400 (MS-0MUR9IN7L0004TO5); was the most overpriced community space (net drain of 10/turn). |

### M3 Community Space Templates (6) — Group B expansion (CG-0MSQJ210I00491ZZ)

Adds reputation assets across four synergies, including the family's first bridge card.

| ID | Name | Cost | Income | Ongoing | Synergy | Tier | Rep/turn | Description | Rationale |
|----|------|------|--------|---------|---------|------|----------|-------------|-----------|
| `cs-playground` | Playground | 300 | 0 | 0 | Entertainment | 2 | 20 | A safe place for kids to play. Provides +20 reputation per turn. | Cheap early reputation asset (rebalanced from T1). Cost re-priced 400 → 300 (MS-0MUR9IN7L0004TO5). |
| `cs-community-garden` | Community Garden | 350 | 0 | 10 | Entertainment | 2 | 40 | A shared community garden that hosts seasonal flower festivals. Costs 10 coins/turn to run; +40 rep/turn. | Entertainment reputation asset with a small running cost; retagged Food → Entertainment (CG-0MUNAQL870015WKF) so the festival garden anchors the Entertainment cluster. Cost re-priced 500 → 350 (MS-0MUR9IN7L0004TO5). |
| `cs-fountain` | Town Fountain | 350 | 0 | 0 | Culture | 3 | 40 | A gathering spot around the fountain. Provides +40 reputation per turn. | Culture reputation asset (rebalanced from T2). Cost re-priced 500 → 350 (MS-0MUR9IN7L0004TO5). |
| `cs-health-kiosk` | Health Kiosk | 450 | 0 | 15 | Health | 3 | 60 | A walk-up health advice kiosk. Costs 15 coins/turn to run; +60 rep/turn. | Health reputation asset; deepens the Health family. Cost re-priced 600 → 450 (MS-0MUR9IN7L0004TO5). |
| `cs-shelter` | Community Shelter | 400 | 0 | 0 | Service | 3 | 60 | A warm shelter for those in need. Provides +60 reputation per turn. | Service reputation asset; retiered T6→T3 (CG-0MT5VZJLS000B8KI) as the neighbourhood amenity anchoring T3's Service leg. Cost re-priced 600 → 400 (MS-0MUR9IN7L0004TO5). |
| `cs-public-art` | Public Art | 600 | 0 | 25 | Culture + Entertainment | 5 | 80 | A vibrant public sculpture. Costs 25 coins/turn to run; +80 rep/turn. Bridges Culture and Entertainment community spaces. | Bridge community space; highest ongoing cost and rep yield (rebalanced from T4). Cost re-priced 800 → 600 (MS-0MUR9IN7L0004TO5). |

### M3 Upgrade Templates (12) — Group E expansion (CG-0MSQJ7SYD008U3EE)

Every Group A business and Group B community space gets an upgrade path (targets raised to maxLevel 1).

| ID | Name | Target | Cost | Income+ | Range+ | Req Lvl | Rep+ | Description |
|----|------|--------|------|---------|--------|--------|------|-------------|
| `upg-smoothie-bar` | Upgrade to Smoothie Bar | Juice Bar | 400 | +100 | 0 | 0 | — | Turns a Juice Bar into a Smoothie Bar with higher income. |
| `upg-wellness-retreat` | Upgrade to Wellness Retreat | Yoga Studio | 500 | +150 | +1 | 0 | — | Expands the Yoga Studio into a full Wellness Retreat. |
| `upg-fitness-center` | Upgrade to Fitness Center | Gym | 500 | +150 | +1 | 0 | — | Expands the Gym into a full Fitness Center. |
| `upg-dental-clinic` | Upgrade to Dental Clinic | Dentist | 700 | +200 | +1 | 0 | — | Expands the Dentist into a full Dental Clinic. |
| `upg-bespoke-tailor` | Upgrade to Bespoke Tailor | Tailor | 400 | +100 | 0 | 0 | — | Elevates the Tailor into a Bespoke Tailor. |
| `upg-toy-warehouse` | Upgrade to Toy Warehouse | Toy Store | 400 | +100 | +1 | 0 | — | Scales the Toy Store into a Toy Warehouse with wider reach. |
| `upg-tea-lounge` | Upgrade to Tea Lounge | Teahouse | 400 | +100 | 0 | 0 | +10 | Turns the Teahouse into a Tea Lounge with a reputation boost. |
| `upg-gourmet-deli` | Upgrade to Gourmet Deli | Delicatessen | 400 | +150 | 0 | 0 | — | Elevates the Delicatessen into a Gourmet Deli. |
| `upg-adventure-park` | Upgrade to Adventure Park | Playground | 300 | 0 | 0 | 0 | +5 | Community-space upgrade; +5 rep/turn. |
| `upg-orchard` | Upgrade to Orchard | Community Garden | 300 | 0 | 0 | 0 | +5 | Community-space upgrade; +5 rep/turn. |
| `upg-grand-fountain` | Upgrade to Grand Fountain | Town Fountain | 300 | 0 | 0 | 0 | +5 | Community-space upgrade; +5 rep/turn. |
| `upg-health-center` | Upgrade to Health Center | Health Kiosk | 400 | 0 | 0 | 0 | +5 | Community-space upgrade; +5 rep/turn. |

### Community Space Upgrades

| ID | Name | Target | Cost | Income+ | Range+ | Description | Rationale |
|----|------|--------|------|---------|--------|-------------|-----------|
| `upg-community-hub` | Upgrade to Community Hub | Library | 400 | 0 | 0 | Library -> Community Hub (+10 rep/turn). | Repurposed: grants +10 reputation/turn instead of income/range bonuses. |

---

## Event Cards

Events fall into two categories:
- **Investment** events are taken from the market into the player's hand for **1 action** (no coins at take; CG-0MTFWBNL30043ZBM); the listed coin cost is paid when the event is played from hand during MarketPhase (CG-0MT5W1V4D007NN8Q). A same-week move + play composite costs **1 action total**. They have generally positive effects.
- **Incident** events live in a hidden face-down incident deck (card back + count only, CG-0MSTOATDP000JNHH). The top card is revealed and resolved at the end of each turn. Most are negative disruptions; a few are positive surprises.

### M1 Event Templates (5)

| ID | Name | Trigger | Cost | Target | Synergy | Coins | Rep | Effect | Rationale |
|----|------|---------|------|--------|---------|-------|-----|--------|-----------|
| `evt-festival` | Local Festival | Investment | 300 | SpecificSynergy | Culture | +200 | +100 | +200 coins to all Culture businesses and +100 reputation. | Core positive Investment for Culture players. |
| `evt-rainy` | Rainy Day | Incident | 0 | SpecificSynergy | Food | -100 | 0 | -100 coin to all Food businesses this turn. | Mild Food disruption. |
| `evt-tax` | Tax Audit | Incident | 0 | All | -- | -300 | 0 | Lose 45% of your banked coins. | Universal economic pressure that scales with wealth; clamped so it cannot bankrupt a player. |
| `evt-award` | Community Award | Incident | 0 | All | -- | 0 | +200 | Gain 200 reputation from community recognition. | Positive incident; balances negative events. |
| `evt-inspection` | Health Inspection | Incident | 0 | SpecificSynergy | Food | -200 | -100 | -200 coins per Food business and -100 reputation. | Harsh Food-specific punishment. |

### M2 Event Templates (12)

#### Investment Events (4)

| ID | Name | Trigger | Cost | Target | Synergy | Coins | Rep | Effect | Rationale |
|----|------|---------|------|--------|---------|-------|-----|--------|-----------|
| `evt-grand-opening` | Grand Opening Sale | Investment | 300 | SpecificSynergy | Commerce | +450 | 0 | +450 coins from a Commerce promotion. | Commerce boost with a same-turn placement gate; rewards coordinated play. |
| `evt-wellness-fair` | Wellness Fair | Investment | 300 | SpecificSynergy | Health | +200 | +150 | +200 coins per Health business and +150 reputation. | Health counterpart to Local Festival. |
| `evt-block-party` | Block Party | Investment | 500 | SpecificSynergy | Entertainment | +250 | +350 | +250 coins per Entertainment business and +350 reputation. | Expensive but high rep payoff for Entertainment. |
| `evt-charity-drive` | Charity Drive | Investment | 900 | All | -- | 0 | +1350 | +1350 reputation from generous donations. | Pure reputation play; universal target. |

#### Incident Events (8)

| ID | Name | Trigger | Cost | Target | Synergy | Coins | Rep | Effect | Rationale |
|----|------|---------|------|--------|---------|-------|-----|--------|-----------|
| `evt-power-outage` | Power Outage | Incident | 0 | All | -- | -200 | 0 | -200 coins from lost business during the outage. | Universal medium disruption. |
| `evt-shoplifting` | Shoplifting Spree | Incident | 0 | SpecificSynergy | Commerce | -200 | 0 | -200 coins per Commerce business from theft losses. | Commerce-specific counterpart to Health Inspection. |
| `evt-noise-complaint` | Noise Complaint | Incident | 0 | SpecificSynergy | Entertainment | -100 | -100 | -100 coin per Entertainment business and -100 reputation. | Entertainment tax; dual penalty. |
| `evt-pipe-burst` | Pipe Burst | Incident | 0 | SpecificSynergy | Service | -200 | 0 | -200 coins per Service business from water damage. | Service-specific disruption. |
| `evt-food-critic` | Food Critic Visit | Incident | 0 | SpecificSynergy | Food | +100 | +100 | +100 coin per Food business and +100 reputation from a glowing review. | Positive incident; rewards Food players. |
| `evt-construction` | Road Construction | Incident | 0 | All | -- | -100 | 0 | -100 coin to all businesses from reduced foot traffic. | Mild universal disruption. |
| `evt-viral-review` | Viral Review | Incident | 0 | All | -- | +200 | +100 | +200 coins and +100 reputation from sudden online fame. | Positive windfall; universal. |
| `evt-vandalism` | Vandalism | Incident | 0 | All | -- | -100 | -100 | -100 coin to all businesses and -100 reputation. | Dual-penalty universal disruption. |
| `evt-flu-outbreak` | Flu Outbreak | Incident | 100 | All | -- | 0 | 0 | All businesses generate 80% income for 5 turns. Duration reduced by Clinic/Medical Center. | Duration-based modifier (see ActiveEffect system). |

### M3 Event Templates (8) — Group C expansion (CG-0MSQJ244M0055X7S)

Gives every synergy a mid-tier Investment option and introduces two new duration effect types.

#### Investment Events (6)

| ID | Name | Cost | Target | Coins/biz | Rep | Tier | Effect | Rationale |
|----|------|------|--------|-----------|-----|------|--------|-----------|
| `evt-health-carnival` | Health Carnival | 350 | Health | +200 | +100 | 3 | +200 coins to all Health businesses and +100 reputation. | Health counterpart to Local Festival. Re-priced 500 → 350 (MS-0MUR9IN7L0004TO5) to lift ROI 0.70× → 1.00×. |
| `evt-food-tasting` | Food Tasting Tour | 350 | Food | +200 | +100 | 3 | +200 coins to all Food businesses and +100 reputation. | Food boost. Re-priced 500 → 350 (MS-0MUR9IN7L0004TO5) to lift ROI 0.70× → 1.00×. |
| `evt-art-sale` | Art Sale | 350 | Culture | +200 | +100 | 3 | +200 coins to all Culture businesses and +100 reputation. | Culture boost. Re-priced 500 → 350 (MS-0MUR9IN7L0004TO5) to lift ROI 0.70× → 1.00×. |
| `evt-shopping-spree` | Shopping Spree | 350 | Commerce | +250 | 0 | 4 | +250 coins to all Commerce businesses. | Commerce boost. Re-priced 700 → 350 (MS-0MUR9IN7L0004TO5) to lift ROI 0.36× → 0.71×. |
| `evt-summer-fest` | Summer Fest | 400 | Entertainment | +200 | +100 | 4 | +200 coins to all Entertainment businesses and +100 reputation. | Entertainment boost. Re-priced 700 → 400 (MS-0MUR9IN7L0004TO5) to lift ROI 0.50× → 0.88×. |
| `evt-service-week` | Service Week | 400 | Service | +200 | +100 | 4 | +200 coins to all Service businesses and +100 reputation. | Service boost. Re-priced 700 → 400 (MS-0MUR9IN7L0004TO5) to lift ROI 0.50× → 0.88×. |

#### Duration Events (2) — new effect types

| ID | Name | Cost | Target | Tier | Duration | Effect Type | Multiplier | Effect | Rationale |
|----|------|------|--------|------|----------|-------------|-----------|--------|-----------|
| `evt-tourist-season` | Tourist Season | 1000 | All | 5 | 3 | `income-multiplier` | 1.15 | All businesses generate 115% income for 3 turns. | **NEW**: positive income-multiplier (previously only negative cuts existed). |
| `evt-community-renovation` | Community Renovation | 1000 | All | 5 | 4 | `rep-multiplier` | 1.2 | All reputation income boosted to 120% for 4 turns. | **NEW**: rep-multiplier effect type (scales per-turn reputation income). |

> Positive duration effects are NOT shortened by Clinic/Medical Center coverage — the reduction applies only to negative multipliers (Group C design decision, CG-0MSQJ244M0055X7S).

### Event Balance Summary

| Category | Count | Avg Coin Delta | Avg Rep Delta |
|----------|-------|---------------|---------------|
| M1 Investment | 1 | +200 | +100 |
| M2 Investment | 4 | +175 | +100 |
| M1 Incident (negative) | 3 | -200 | -33 |
| M1 Incident (positive) | 1 | 0 | +200 |
| M2 Incident (negative) | 5 | -140 | -40 |
| M2 Incident (positive) | 3 | +133 | +100 |
| M2 Incident (duration) | 1 | 0 | 0 |

> Duration-based incidents (e.g. `evt-flu-outbreak`) apply an ActiveEffect instead of a one-shot delta. Their impact is listed as 0 coin/rep delta because the effect is applied over multiple turns via an income multiplier.

The M2 incident pool is more balanced than M1: 5 negative vs. 3 positive incidents (compared to M1's 3 negative vs. 1 positive). This reduces the punishing feel while maintaining strategic tension.

---

## Week Windows (Seasonal & Holiday Events)

Starting with work item CG-0MTT0K9RX0004QTE, each event card can carry optional week-window fields (`availableWeekStart`, `availableWeekEnd`). Cards without a window are **year-round** (always offerable/drawable). Cards with a window are only offerable/drawable when the current game week falls within `[start, end]` inclusive.

The calendar model advances one week per turn (52-week year, wrapping to year 2 at week 53). A new game starts at a random week chosen from the allowed set `{1–8, 16–24, 40–46}` so that different sessions experience different points in the annual cycle.

### New Irish-Holiday Event Cards

Seven new Investment event cards rooted in the Irish calendar, added at CG-0MTT0K9RX0004QTE:

| ID | Name | Weeks | Tier | Trigger | Effect | Rationale |
|---|---|---|---|---|---|---|
| `evt-st-brigids` | St Brigid's Day | 5 | 3 | Investment | +450 reputation from community celebration of renewal. | Imbolc — renewal at start of spring |
| `evt-st-patricks` | St Patrick's Day | 11–12 | 4 | Investment | +400 coins to all Commerce businesses and +350 reputation. | Island-wide celebration |
| `evt-easter` | Easter | 13–17 | 5 | Investment | +200 coin to all businesses and +500 reputation. | Spring festival and community gathering |
| `evt-may-day` | May Day / Bealtaine | 18 | 4 | Investment | +350 coins per Entertainment business and +250 reputation. | May Day dances and celebrations |
| `evt-lughnasadh` | Lughnasadh | 31 | 6 | Investment | +500 coins per Food business and +350 reputation. | Ancient harvest games and fair |
| `evt-samhain` | Samhain / Halloween | 44 | 7 | Investment | +450 coins per Entertainment business and +500 reputation. | Spooky autumn festival and bonfire night |
| `evt-christmas` | Christmas | 51–52 | 8 | Investment | +600 coins to all businesses and +650 reputation. | Christmas festivities and seasonal cheer |

### Existing Event Cards — Week-Gate Audit

All 64 original event cards were audited. Seasonal/festival/tourist-style events received windows; generic economic/administrative incidents remain year-round.

| ID | Name | Window | Rationale |
|---|---|---|---|
| `evt-festival` | Local Festival | 18–35 | Festival season |
| `evt-festival-season` | Festival Season | 23–35 | Extended festival season |
| `evt-block-party` | Block Party | 22–33 | Summer street festivities |
| `evt-tourist-season` | Tourist Season | 23–35 | Peak tourist months |
| `evt-tourist-bus` | Tourist Bus | 23–35 | Tourist season incident |
| `evt-heatwave` | Heatwave | 23–35 | Summer weather event |
| `evt-street-performer` | Street Performer | 22–35 | Summer fair circuit |
| `evt-food-tasting` | Food Tasting Tour | 20–36 | Summer fair circuit |
| `evt-health-carnival` | Health Carnival | 20–36 | Summer fair circuit |
| `evt-art-sale` | Art Sale | 20–36 | Summer fair circuit |
| `evt-harvest-festival` | Harvest Festival | 38–41 | Autumn harvest |
| `evt-summer-fest` | Summer Fest | 23–35 | Summer festival |

**Year-round** (no window — always offerable/drawable): `evt-rainy`, `evt-tax`, `evt-award`, `evt-inspection`, `evt-grand-opening`, `evt-wellness-fair`, `evt-charity-drive`, `evt-power-outage`, `evt-shoplifting`, `evt-noise-complaint`, `evt-pipe-burst`, `evt-food-critic`, `evt-construction`, `evt-viral-review`, `evt-vandalism`, `evt-flu-outbreak`, `evt-recession`, `evt-health-campaign`, `evt-bulk-purchase`, `evt-book-fair`, `evt-volunteer-day`, `evt-community-garden`, `evt-protest`, `evt-supply-chain`, `evt-power-surge`, `evt-strike`, `evt-pest-infestation`, `evt-slow-season`, `evt-good-press`, `evt-cultural-grant`, `evt-shopping-spree`, `evt-service-week`, `evt-community-renovation`, `evt-graffiti`, `evt-graffiti-art`, `evt-water-main`, `evt-parking-tickets`, `evt-labor-shortage`, `evt-movie-premiere`, `evt-health-screening`, `evt-farmers-market`, `evt-library-reading`, `evt-street-cleaning`, `evt-neighborhood-watch`, `evt-tax-error`, `evt-tax-inquiry`, `evt-strike-service`, `evt-general-strike`, `evt-popular-menu`, `evt-farm-table`, `evt-depression`, `evt-pandemic`

---

## Upgrade Cards

Each Upgrade targets a specific Business by name. Applying an upgrade increments the business's level, adds an income bonus, and optionally extends synergy range.

### M1 Upgrade Templates (3)

| ID | Name | Target | Cost | Income+ | Range+ | Description | Rationale |
|----|------|--------|------|---------|--------|-------------|-----------|
| `upg-patisserie` | Upgrade to Patisserie | Bakery | 300 | +100 | +1 | Bakery -> Patisserie. | Classic upgrade; income + range. |
| `upg-bistro` | Upgrade to Bistro | Diner | 300 | +100 | +1 | Diner -> Bistro. | Matches Patisserie in cost/power. |
| `upg-readers-cafe` | Upgrade to Reader's Café | Bookshop | 300 | +100 | 0 | Bookshop -> Reader's Café (+10 rep/turn). | Cheaper; income only, no range; reputation bonus. |

### M2 Standard Upgrade Templates (14)

| ID | Name | Target | Cost | Income+ | Range+ | Description | Rationale |
|----|------|--------|------|---------|--------|-------------|-----------|
| `upg-community-hub` | Upgrade to Community Hub | Library | 400 | 0 | 0 | Library -> Community Hub (+10 rep/turn). | Community space upgrade for Library; reputation bonus. |
| `upg-garden` | Upgrade to Garden | Park | 300 | +100 | +1 | Park -> Garden. | Completes M1 Culture upgrade / community space upgrade coverage. |
| `upg-home-improvement` | Upgrade to Home Improvement | Hardware Store | 700 | +200 | +1 | Hardware Store -> Home Improvement. | Completes M1 Commerce upgrade. |
| `upg-vintage-shop` | Upgrade to Vintage Shop | Pawn Shop | 300 | +100 | 0 | Pawn Shop -> Vintage Shop. | Budget upgrade; income only. |
| `upg-designer-store` | Upgrade to Designer Store | Boutique | 700 | +200 | +1 | Boutique -> Designer Store. | Premium Commerce upgrade. |
| `upg-dry-cleaners` | Upgrade to Dry Cleaners | Laundromat | 300 | +100 | 0 | Laundromat -> Dry Cleaners. | Service entry-level upgrade. |
| `upg-salon` | Upgrade to Salon | Barbershop | 900 | +300 | +1 | Barbershop -> Salon. | Service upgrade with range. |
| `upg-gaming-lounge` | Upgrade to Gaming Lounge | Arcade | 700 | +200 | +1 | Arcade -> Gaming Lounge. | Entertainment mid-tier upgrade. |
| `upg-imax` | Upgrade to IMAX Theater | Cinema | 700 | +300 | +1 | Cinema -> IMAX Theater. | Premium upgrade; highest income bonus (tied). |
| `upg-roastery` | Upgrade to Roastery | Cafe | 900 | +300 | +1 | Cafe -> Roastery. | Bridge card upgrade; maintains dual synergy. |
| `upg-gourmet-truck` | Upgrade to Gourmet Truck | Food Truck | 300 | +150 | 0 | Food Truck -> Gourmet Truck. | Cheapest upgrade in the pool. |
| `upg-museum` | Upgrade to Museum | Art Gallery | 700 | +200 | +1 | Art Gallery -> Museum. | Premium bridge upgrade. |
| `upg-resort-spa` | Upgrade to Resort Spa | Day Spa | 900 | +350 | +1 | Day Spa -> Resort Spa. | Tied with IMAX for highest cost/power. |
| `upg-garden-center` | Upgrade to Garden Center | Flower Shop | 700 | +200 | +1 | Flower Shop -> Garden Center. | Budget bridge upgrade with range. |
| `upg-medical-center` | Upgrade to Medical Center | Clinic | 300 | 0 | +1 | Clinic -> Medical Center. Provides +10 rep/turn. | Reputation bonus upgrade; no income. |
| `upg-private-medical-center` | Upgrade to Private Medical Center | Private Clinic | 900 | +450 | +1 | Private Clinic -> Private Medical Center. | Income-focused upgrade; no range or reputation. |

### M2 Branching Upgrade Templates (4)

Branching upgrades offer an alternative Level-1 path for businesses that already have a standard upgrade. Where the standard upgrade typically provides balanced income + range, branching upgrades favour one stat over the other, creating meaningful upgrade decisions. All branching upgrades have `requiredLevel: 0`.

| ID | Name | Target | Cost | Income+ | Range+ | Description | Rationale |
|----|------|--------|------|---------|--------|-------------|-----------|
| `upg-bread-factory` | Upgrade to Bread Factory | Bakery | 700 | +500 | +1 | Scales into high-volume Bread Factory. More income, no range. | Volume-over-reach alternative to Patisserie (+100/+1). |
| `upg-fast-food` | Upgrade to Fast Food | Diner | 700 | +500 | +1 | Converts to a Fast Food outlet. Higher income, no range. | Volume alternative to Bistro (+100/+1). |
| `upg-drive-in` | Upgrade to Drive-In Theater | Cinema | 700 | +200 | +2 | Turns Cinema into a Drive-In with wider community reach. | Reach-over-income alternative to IMAX (+200/+1). |
| `upg-wellness-center` | Upgrade to Wellness Center | Day Spa | 900 | +250 | +2 | Expands into a Wellness Center with broader service footprint. | Reach alternative to Resort Spa (+200/+1). |

### M2 Multi-Level Upgrade Templates (4)

Multi-level upgrades require the business to already be at Level 1 (`requiredLevel: 1`). They represent a second upgrade step, available only after a Level-1 upgrade (standard or branching) has been applied. These are the most powerful upgrades in the pool and serve as late-game progression rewards.

| ID | Name | Target | Cost | Income+ | Range+ | Req Level | Description | Rationale |
|----|------|--------|------|---------|--------|-----------|-------------|-----------|
| `upg-grand-bakehouse` | Upgrade to Grand Bakehouse | Bakery | 900 | +350 | +1 | 1 | Pinnacle of baking — draws visitors from afar. | Level-2 capstone for Bakery chain. |
| `upg-restaurant` | Upgrade to Restaurant | Diner | 1400 | +550 | +1 | 1 | Elevates to a full-service Restaurant. | Level-2 capstone for Diner chain. |
| `upg-multiplex` | Upgrade to Multiplex | Cinema | 1400 | +700 | +1 | 1 | Massive entertainment complex — heart of Main Street. | Highest income bonus in pool (+300). |
| `upg-luxury-retreat` | Upgrade to Luxury Retreat | Day Spa | 1400 | +700 | +1 | 1 | Destination Luxury Retreat — most prestigious business. | Tied with Multiplex for highest income bonus. |

### Upgrade Cost Distribution

| Cost | Count | Cards |
|------|-------|-------|
| 200 | 1 | Gourmet Truck |
| 300 | 9 | Reader's Café (Bookshop upgrade), Garden, Vintage Shop, Dry Cleaners, Salon, Roastery, Garden Center, Bread Factory, Fast Food |
| 400 | 8 | Patisserie, Bistro, Designer Store, Gaming Lounge, Museum, Drive-In Theater, Wellness Center, Community Hub |
| 500 | 6 | Home Improvement, IMAX Theater, Resort Spa, Medical Center, Grand Bakehouse, Restaurant |
| 600 | 2 | Multiplex, Luxury Retreat |

---

## Design Notes

### Multi-Synergy Bridge Cards

The adjacency resolver (`MainStreetAdjacency.ts`) uses `some()` to check if any synergy type matches, so bridge cards earn bonuses from neighbours of either type — a Cafe (Food+Culture) placed between a Bakery and a Bookshop earns bonuses from both sides. Bridges are also the primary lever for spreading synergy types across sparse tiers: since a bridge counts one card toward two types, a 2-card tier can span 3–4 types. T3's Entertainment 2 / Service 1 span now comes from the retiered Community Shelter rather than a bridge (Arcade is Entertainment-only since CG-0MT5VZJLS000B8KI).

### Synergy Type Coverage

| Synergy | Single-type | Bridge (shared) | Total |
|---------|-------------|-----------------|-------|
| Food | 3 (Bakery, Delicatessen, Diner) | 4 (Cafe, Food Truck, Juice Bar, Teahouse) | 7 |
| Culture | 5 (Bookshop, Charity Shop, Craft Shop, Library, Town Fountain) | 6 (Art Gallery, Cafe, Flower Shop, Public Art, Teahouse, Yoga Studio) | 11 |
| Commerce | 3 (Boutique, Pawn Shop, Toy Store) | 1 (Flower Shop) | 4 |
| Service | 6 (Barbershop, Community Shelter, Grand Hotel, Hardware Store, Laundromat, Tailor) | 2 (Day Spa, Physiotherapist) | 8 |
| Entertainment | 6 (Arcade, Cinema, Community Garden, Music Store, Park, Playground) | 4 (Art Gallery, Day Spa, Food Truck, Public Art) | 10 |
| Health | 6 (Clinic, Dentist, Gym, Health Kiosk, Pharmacy, Private Clinic) | 3 (Juice Bar, Physiotherapist, Yoga Studio) | 9 |

Service and Health now have bridge representation on a par with the other types, while Commerce remains the most single-type reliant (its only bridge is the Flower Shop). Global totals are intentionally not balanced per type (Culture 11 vs Commerce 4) — the balance rule is defined **per tier**, mirroring the family rebalance (CG-0MT2WU0CX005Z143) along the synergy-type axis.

> **Per-tier synergy balance (CG-0MT3IPFSF005KEFB):** every tier's synergy-bearing cards (business + community-space) span ≥ 2 distinct types, and no type's assignment count within a tier exceeds 2× any other type's count in that tier (bridge cards count once per type they carry). Sparse tiers are stretched with retags/retiers rather than new cards: T1 Park Culture→Entertainment, T2 Hardware Store Commerce→Service, T3 Arcade stays Entertainment with the Community Shelter retiered 6→3 (CG-0MT5VZJLS000B8KI) → Entertainment 2 / Service 1. The producer-added Charity Shop later adds T2 Culture (MS-0MUAYBAHW007RMSL), giving Commerce 2 / Service 1 / Culture 1. T4 Community Garden retagged Food→Entertainment (CG-0MUNAQL870015WKF), giving Service 1 / Food 1 / Entertainment 2 (both satisfy the 2× ratio). Enforced by `tests/main-street/tier-synergy-balance.test.ts`.

### Branching & Multi-Level Upgrades

M2 introduces two new upgrade mechanics that deepen progression decisions:

**Branching Upgrades** — Four businesses (Bakery, Diner, Cinema, Day Spa) now have two Level-1 upgrade options instead of one. The player must choose between them since applying one locks out the other. Each pair offers a different trade-off:

| Business | Standard Path | Branching Path | Trade-off |
|----------|--------------|----------------|-----------|
| Bakery | Patisserie (+100/+1) | Bread Factory (+200/+0) | Income vs. range |
| Diner | Bistro (+100/+1) | Fast Food (+200/+0) | Income vs. range |
| Cinema | IMAX (+200/+1) | Drive-In (+100/+2) | Income vs. range |
| Day Spa | Resort Spa (+200/+1) | Wellness Center (+100/+2) | Income vs. range |

**Multi-Level Upgrades** — Four Level-2 upgrades require the target business to already be at Level 1 (`requiredLevel: 1`). These apply after any Level-1 path (standard or branching), creating 2-step upgrade chains. The multi-level upgrades are the most expensive and powerful cards in the pool (cost 500-600, income +200 to +300).

### Running the Monte Carlo Balance Sweep

The market integration test suite (`tests/main-street/market.integration.test.ts`) includes a Monte Carlo stability test that runs 200 seeds over 60 turns each (harness-only termination cap — default presets impose no turn limit):

```bash
# Run just the Monte Carlo sweep
npx vitest run --project unit -t "Monte Carlo"

# Run all market integration tests
npx vitest run --project unit tests/main-street/market.integration.test.ts
```

The sweep verifies:
- No deck starvation (decks never run dry mid-refill)
- No duplicate cards in market slots
- Coins remain non-negative within expected bounds
- The game terminates normally for every seed

To add custom balance checks, extend the `Monte Carlo stability sweep` describe block in `market.integration.test.ts`.

For the dedicated balance harness and report outputs, use:

```bash
npm run monte-carlo
```

_(runs via `vite-node` — the Vite-aware ESM loader — because the harness imports
deck-building functions from `MainStreetCards.ts`, which loads `card-data.csv`
through Vite's `?raw` suffix; the same reason the manifest generator above uses
`npx vite-node`.)_

This writes per-run and aggregate metrics to:
- `results/main-street-monte-carlo.json`
- `results/main-street-monte-carlo.csv`

## See Also

- **[Balance Process & Tooling PRD](prd-balance-process-and-tooling.md)** — Defines the structured balance review process, micro/macro metrics, and CLI tool specifications that read card-data.csv alongside Monte Carlo output.
- **[Balancing Methodology](balancing-methodology.md)** — Technical description of the `run-balance-cards` balancing algorithm.
- **[Monte Carlo Sample Results](monte-carlo-sample-results.md)** — Example output from the Monte Carlo simulation harness.
- **[Playtest Scenarios](playtest-scenarios.md)** — Curated deterministic seeds for manual balance validation.


## Staff Cards

Staff cards are a separate card family (`family: 'staff'`) that expand hand capacity at an ongoing per-turn coin cost. They do not occupy hand slots and are tier-gated like every other family (rebalance CG-0MT2WU0CX005Z143; 12-tier spread CG-0MT3C744B009DS84): staff unlock as their tier is reached, so a fresh run starts with only the Tier-1 staff (Apprentice). They are hired directly from the general market row (0–1 staff per row, `MARKET_STAFF_MAX`) — there is no dedicated staff market (CG-0MT2WTN0L004JA53). A second wave of 12 specialization applicant cards (CG-0MT4WXNR80090FXZ) adds role-themed staff across tiers 2–5; none grant hand slots — they are employed-applicant cards whose effects (synergy/incident/cost bonuses) are wired by the staff-specialization epic. **Staff specialization skills** (1–3 locked skills per applicant, Town Gossip baseline, stacking caps) are documented in [specialization-skills.md](specialization-skills.md). **Business-specialist staff** (CG-0MTIOLY2A0092OT1) carry an `allowedBusinessTypes` list (specific business names and/or synergy types); they may only be employed at matching businesses and are purchasable from the general market like other staff. The **Investor** (`staff-investor`, MS-0MTISBYLS009936W) adds a market-shaping ability: while employed it grants one coin-free, action-free market re-roll per turn, biased 75% toward the hosting business's synergy types, driven by the new `freeMarketRerollPerTurn` flag and `marketRelevanceBias` fraction columns. See [core-rules-and-mechanics.md](./core-rules-and-mechanics.md) for the full mechanic. Relocating **any** employed staff member to another business now costs 1 action point (MS-0MUOSUNYR0073SI1); the initial placement at hire time remains free.

| ID | Name | Cost | Ongoing/turn | Slots+ | Tier | Ability | Description | Rationale |
|----|------|------|--------------|--------|------|---------|-------------|-----------|
| `staff-apprentice` | Apprentice | 200 | 50 | +1 | 1 | — | A budget hire who frees up a hand slot with a small ongoing cost. | Budget entry point *(Group F).* |
| `staff-assistant` | Assistant | 300 | 100 | +1 | 2 | — | Hire an assistant to help manage your hand. | Original M2 staff. |
| `staff-manager` | Manager | 700 | 250 | +1 | 3 | +1 action/turn | A skilled manager keeps things organised. Adds +1 hand slot and an extra action per week. | Mid-tier action economy, traded against one hand slot *(MS-0MTQ7S5EJ008MWD0).* |
| `staff-socialite` | Socialite | 800 | 150 | +1 | 4 | +10 rep/turn | A charming socialite adds +1 hand slot and +10 reputation per turn. | **NEW** reputation ability *(Group F).* |
| `staff-accountant` | Accountant | 800 | 150 | +1 | 6 | Refresh −100; Tax 25% | A meticulous accountant makes market refreshes cost 100 less and reduces Tax Audit losses to 25%. | **NEW** economy ability *(Group F); Tax Audit mitigation (CG-0MTQ7W0ZX0059R3J); refresh discount rescaled ×100 (CG-0MTKMGL66004I0PC).* |
| `staff-lookout` | Lookout | 1000 | 200 | +1 | 7 | Peek once/turn | A sharp-eyed lookout can peek at the top card of the incident deck once per turn. | **NEW** peek ability *(CG-0MSXOW6GN008ZSMN).* |
| `staff-director` | Director | 1400 | 400 | +3 | 9 | +1 action/turn | An experienced director oversees your operations and grants an extra action per week. | Premium action economy + capacity *(MS-0MTQ7S5EJ008MWD0).* |
| `staff-executive` | Executive | 2000 | 500 | +4 | 10 | — | An experienced executive adds major hand capacity at a high ongoing cost. | Premium slot capacity *(Group F).* |
| `staff-general-manager` | General Manager | 2000 | 500 | +4 | 12 | +1 action/turn | A seasoned leader grants **+1 action per week** while employed (2 actions instead of 1). | **NEW** action-economy ability *(CG-0MSTOF1N5005PK2R).* |
| `staff-barista` | Barista | 300 | 50 | — | 2 | Food synergy | A skilled barista brings warmth to any business. Adjacent Food businesses gain +20 synergy coins. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-bookkeeper` | Bookkeeper | 300 | 50 | — | 2 | −20% ongoing | Keeps the books tight. Reduces this business ongoing cost by 20%. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-customer-rep` | Customer Service Rep | 300 | 50 | — | 2 | Service synergy | Ensures every visitor leaves satisfied. Adjacent businesses gain +10 synergy reputation. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-delivery` | Delivery Driver | 300 | 50 | — | 2 | -50 purchase cost | Handles the logistics. Reduces business card purchase cost by 50. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ); street-wide purchase discount implemented (`purchaseCostDiscount = 50`) across all acquisition paths (click, drag, deferred play-from-hand) — CG-0MUMCVH3N007KT1M. |
| `staff-security` | Security Guard | 700 | 75 | — | 3 | −10% incident coins | Experienced guard watches over the street. Reduces all incident coin damage by 10%. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-marketing` | Marketing Consultant | 700 | 100 | — | 3 | +10% rep sources | Expert at drawing crowds. Businesses gain +10% reputation from all sources. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-event-planner` | Event Planner | 700 | 75 | — | 3 | Entertainment synergy | Creates buzz and draws visitors. +100 synergy coin per turn from Entertainment businesses. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-maintenance` | Maintenance Worker | 700 | 75 | — | 3 | -50 incident rep | Keeps everything running smoothly. Reduces incident reputation damage by 50. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-it` | IT Specialist | 800 | 100 | — | 4 | Refresh −100 | Modernizes operations. Reduces market refresh cost by 100. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ); rescaled ×100 (CG-0MTKMGL66004I0PC); street-wide refresh discount implemented (`refreshCostDiscount = 100`), stacks with Accountant and Negotiator — CG-0MUMCVH3N007KT1M. |
| `staff-health-safety` | Health & Safety Inspector | 800 | 100 | — | 4 | −10% Health incidents | Keeps everything up to code. Reduces incident frequency by 10% for Health businesses. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-pr` | PR Officer | 800 | 100 | — | 4 | +15 rep/turn | Manages the street image. +15 reputation per turn from all businesses. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ).* |
| `staff-financial` | Financial Advisor | 1000 | 125 | — | 5 | Upgrade −100 | Smart investments pay off. Reduces this business upgrade cost by 100. | **NEW** specialization applicant *(CG-0MT4WXNR80090FXZ); per-business upgrade discount implemented (`upgradeCostDiscount`) — market, hand and drag paths (CG-0MTKMGL66004I0PC).* |
| `staff-florist` | Florist | 400 | 75 | — | 2 | Commerce/Culture bonus | A specialist florist brings beauty and trade. +30 coins per turn from adjacent Commerce and Culture businesses. Serves Flower Shop, Commerce, Culture. | **NEW** business specialist *(CG-0MTIOLY2A0092OT1).* |
| `staff-baker` | Baker | 400 | 80 | — | 2 | Food bonus | A master baker keeps the neighbourhood well-fed. +25 coins per turn from adjacent Food businesses. Serves Bakery, Food. | **NEW** business specialist *(CG-0MTIOLY2A0092OT1).* |
| `staff-chef` | Chef | 600 | 100 | — | 3 | +20% Food income | An experienced chef boosts nearby Food businesses with +20% income. Serves Cafe/Diner/Delicatessen, Food. | **NEW** business specialist *(CG-0MTIOLY2A0092OT1).* |
| `staff-mechanic` | Mechanic | 500 | 90 | — | 3 | +30 coins Service | A skilled mechanic keeps Service businesses running smoothly. +30 coins per turn from a Service business. Serves Hardware Store, Service. | **NEW** business specialist *(CG-0MTIOLY2A0092OT1).* |
| `staff-investor` | Investor | 1000 | 125 | — | 5 | Free re-roll/turn (75% relevance) | A savvy investor works the market. Grants one free market re-roll each turn with a 75% bias toward this business's synergy types. | **NEW** market-shaping ability — one coin-free, action-free re-roll per turn; advances the paid escalation counter; generalist (`allowedBusinessTypes` = every synergy type) *(MS-0MTISBYLS009936W).* |
