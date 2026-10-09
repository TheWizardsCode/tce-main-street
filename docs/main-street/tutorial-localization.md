# Tutorial Localization Guide

The Main Street tutorial system externalises all user-facing copy through the
core engine's [i18n module](../../core/src/core-engine/I18n.ts). This means tutorial
text can be translated and reviewed without editing gameplay code.

## Architecture

Tutorial step definitions in [`TutorialFlow.ts`](../../src/TutorialFlow.ts)
no longer contain inline string literals for titles and bodies. Instead, each
step carries an i18n **key**:

```ts
// Before (hardcoded)
{ id: 'T1', title: 'Welcome to Main Street', body: '...' }

// After (i18n key)
{ id: 'T1', titleKey: 'tutorial.T1.title', bodyKey: 'tutorial.T1.body' }
```

The actual string values are stored in **locale bundles**. English copy lives in
[`tutorial-en.csv`](../../src/i18n/tutorial-en.csv) — a
spreadsheet-editable `key,text` CSV — which is bundled at build time via Vite's
`?raw` import and parsed by the core [`parseCsv()`](../../core/src/core-engine/CsvLoader.ts)
helper into the `TUTORIAL_EN_BUNDLE` exported by
[`tutorial-en.ts`](../../src/i18n/tutorial-en.ts). The `.ts`
module now holds only the key helpers and the loader; it contains no copy.

At runtime, the overlay manager ([`MainStreetTutorialHints`](../../src/scenes/MainStreetTutorialHints.ts))
calls `t(key)` to resolve the active locale's string for each step. The
English bundle is registered at module load time, so it is always available
as a fallback.

### Card-data placeholders

Step bodies that reference card facts (card **name**, **cost**, or **income
bonus**) MUST use placeholder tokens instead of hardcoded values.  The
placeholders are substituted with live values from `card-data.csv` at render
time, so rebalancing card data never leaves the tutorial stale.

| Placeholder | Resolved from | Example |
|-------------|---------------|---------|
| `{cardName}` | card's `name` column | `Laundromat` |
| `{cost}` | card's `cost` column via `formatCurrency()` | `€400` |
| `{bonus}` | event card's `coinDelta` as `+N coins` | `+200 coins` |

Example (T3 body in `tutorial-en.csv`):

```csv
key,text
tutorial.T3.body,"Buy the **{cardName}** card from the Development row for {cost}. ..."
```

#### How placeholders are resolved

1. `resolveTutorialStepText(step)` in `TutorialFlow.ts` calls
   `resolveTutorialCardParams(step)`.
2. The step's `requiredCardId` (purchase-gated steps like T3/T9) or
   `referencedCardId` (text-only references like T7/T9) provides the card
   lookup key (e.g. `biz-laundromat-0`).
3. `getBaseTypeId()` strips the copy suffix (`biz-laundromat`) and
   `getCsvRows()` finds the matching row in the live `card-data.csv`.
4. `formatCurrency()` formats the cost and the params are passed to
   `t(key, params)` in the core i18n module, which interpolates the
   `{token}` placeholders.
5. If a referenced card is missing from the CSV, resolution **throws** —
   the tutorial fails loudly rather than rendering raw `{token}` text.

The overlay manager renders the resolved text in both DOM and Phaser modes
via `resolveTutorialStepText(step)`, so both render paths stay in sync with
card data.

### Key naming convention

All tutorial step keys follow the pattern:

```
tutorial.<STEP_ID>.<field>
```

Where:
- `<STEP_ID>` is the step identifier (e.g. `T1`, `T3`, `T13`)
- `<field>` is `title` or `body`

Examples:
- `tutorial.T1.title`
- `tutorial.T3.body`
- `tutorial.T13.title`

The `tutorialKey()` helper function constructs these keys:

```ts
import { tutorialKey } from '../../src/i18n/tutorial-en';

tutorialKey('T3', 'title'); // → 'tutorial.T3.title'
```

### Offer modal and overlay button keys

The tutorial offer modal and overlay button labels are also externalized:

| Key pattern | Description | Example value (English) |
|------------|-------------|------------------------|
| `tutorial.modal.title` | Offer modal title | `Welcome to Main Street!` |
| `tutorial.modal.body` | Offer modal body text | `Would you like a tour to learn the basics of Main Street?` |
| `tutorial.modal.skipBtn` | Skip button label | `Skip` |
| `tutorial.modal.startBtn` | Start Tutorial button | `Start Tutorial` |
| `tutorial.overlay.dismiss` | Dismiss overlay button | `Dismiss` |
| `tutorial.overlay.next` | Next step button | `Next >` |
| `tutorial.overlay.exit` | Exit tutorial button | `Exit Tutorial` |
| `tutorial.overlay.startFullGame` | Start full game button | `Let's play!` |

Helper functions:

```ts
import { modalKey, overlayKey } from '../../src/i18n/tutorial-en';

modalKey('title');     // → 'tutorial.modal.title'
overlayKey('dismiss'); // → 'tutorial.overlay.dismiss'
```

## Updating Tutorial Copy

### Plain-language guidelines

Tutorial text follows these editorial principles:

- **Reading level:** ~10-year-old reading level (Flesch-Kincaid Grade Level ≤ 5-6)
- **Sentence limit:** **≤3 sentences per text box** (titles and bodies), each box
  communicating **exactly one point** (25-step flow editorial rule)
- **Word count:** Each step body under 50 words (soft boundary — conciseness preferred)
- **Concepts:** At most 1–2 distinct gameplay concepts per step (soft boundary)
- **Plain language:** Short sentences, common words, active voice, no jargon without explanation
- **Consistency:** Use consistent terminology across all steps (e.g. "Coins" not "gold", "turns" not "days")

> **Terminology:** One turn = one week. See
> [Core Rules — Time and Terminology](core-rules-and-mechanics.md#11-time-and-terminology)
> for the canonical vocabulary rule ("this week"/"next week"; the activity-log
> header stays `Turn N`). `scripts/check-terminology-guards.sh` enforces it.

### Content rules for the 25-step two-turn flow

- Do NOT mention time-limited play (the "25 turns" sentence was removed from T1).
- Do NOT describe incident cards as "blue" or list their impacts in Upcoming Incidents.
- Do NOT mention matching cards in the Place a Business step.

### Step flow (25 steps, T1–T25)

| # | ID | Title | Gate | Highlight zone |
|---|----|-------|------|----------------|
| 1 | T1 | Welcome to Main Street | confirm | centerModal |
| 2 | T2 | The Market Row | confirm | developmentRow |
| 3 | T3 | Buy the Laundromat | action (select-business) | laundromatCard (card-level) |
| 4 | T4 | Your Hand | confirm | hand |
| 5 | T5 | Upcoming Incidents | confirm | incidentQueue |
| 6 | T6 | End Turn | action (end-turn) | endTurnButton |
| 7 | T7 | Place a Business | action (place-business) | streetGrid |
| 8 | T8 | End this turn | action (end-turn) | endTurnButton |
| 9 | T9 | More than Businesses | confirm | investmentsRow |
| 10 | T10 | Buy the Local Festival | action (buy-event) | festivalCard (card-level) |
| 11 | T11 | End this turn | action (end-turn) | endTurnButton |
| 12 | T12 | Move the Bookshop to hand | action (select-business) | developmentRow |
| 13 | T13 | Costs and Reputation | confirm | developmentRow |
| 14 | T14 | End this turn | action (end-turn) | endTurnButton |
| 15 | T15 | Community Favour | action (community-favour, rep→coins) | actionButtons |
| 16 | T16 | Place the Bookshop | action (place-business) | streetGrid |
| 17 | T17 | End this turn | action (end-turn) | endTurnButton |
| 18 | T18 | Move the Library to hand | action (select-business) | developmentRow |
| 19 | T19 | End this turn | action (end-turn) | endTurnButton |
| 20 | T20 | Build a Library | action (place-business + synergy) | streetGrid |
| 21 | T21 | End this turn | action (end-turn) | endTurnButton |
| 22 | T22 | Triggering Events | action (play-event) | hand |
| 23 | T23 | Success and Failure | confirm | hud (scoring bar) |
| 24 | T24 | Challenges | confirm | challengePanel |
| 25 | T25 | Tutorial Complete | confirm | completionModal (Steam follow CTA) |

Every purchase is a **two-turn plan-ahead flow** (CG-0MT53NXGZ004H5AE): move a
card to hand in week N (its one action), End Turn, then place it from hand in week
N+1 at its **listed cost** (another action). No same-week composite step exists,
so no +50% premium is ever scripted. T13 (Costs and Reputation) is an
informative step that introduces the Library's running cost vs reputation
trade-off; the Culture synergy rule (place the Library next to the Bookshop) is
taught by T20. T15 teaches the Community Favour rep→coins exchange
(CG-0MSTOATDQ005XDET) — useful but not strictly required in the two-turn budget.
T25 carries the Steam follow CTA (CG-0MSMAJQQT004SDCC), which never blocks
finishing. Gate count: 9 confirm + 16 action = 25.

Card-level highlight zones (`laundromatCard`, `festivalCard`) are resolved through
`resolveMarketCardAnchor()` in `MainStreetTutorialHints.ts` using the deterministic
tutorial-scenario market slots, not hardcoded pixel positions.

### Scenario budget (Easy / 1200 coins)

The tutorial runs the **Easy** preset with a **1200-coin starting budget**. The
two-turn flow places each card the week after its move at **listed cost** (no
same-week premium), so every balance stays positive (CG-0MT53NXGZ004H5AE):

| Step | Action | Coins In | Coins Out | Balance |
|------|--------|----------|-----------|---------|
| T1 | Start (Easy, 1200 coins) | 1200 | 0 | 1200 |
| T3 | Move Laundromat to hand (1 action) | 0 | 0 | 1200 |
| T6 | End Turn (held-card cost -1) | 0 | 100 | 1100 |
| T7 | Place Laundromat (listed $400) | 0 | 400 | 700 |
| T8 | End Turn (day 2 → 3) | 0 | 0 | 700 |
| T10 | Buy Local Festival (event, $300) | 0 | 0 | 700 |
| T11 | End Turn + income (~215) | 215 | 0 | 915 |
| T12 | Move Bookshop to hand | 0 | 0 | 915 |
| T14 | End Turn (day 4 → 5) | 120 | 0 | 1035 |
| T15 | Community Favour (200 rep → 300c) | 300 | 0 | 1335 |
| T16 | Place Bookshop (listed $300) | 0 | 300 | 1035 |
| T17 | End Turn + income (~391) | 391 | 0 | 1426 |
| T18 | Move Library to hand | 0 | 0 | 1426 |
| T19 | End Turn + income (~392) | 392 | 0 | 1818 |
| T20 | Place Library (listed $700) | 0 | 700 | 1118 |
| T21 | End Turn + income (~100) | 100 | 0 | 1218 |
| T22 | Play Local Festival (~+100 net) | 100 | 0 | 1318 |
| T23+ | Confirm steps (no cost) | 0 | 0 | ≥ 1318 |

All placements are at listed cost because each follows an End Turn
(plan-ahead). The deterministic 5-incident deck (Community Award ×3, Rainy Day
×2 — both non-negative on the tutorial street) never drains the balance. The
authoritative walkthrough lives in the `Coin Budget (Easy / 1200 coins)` table in
`src/TutorialScenario.ts`.

### Changing existing text

1. Open [`i18n/tutorial-en.csv`](../../src/i18n/tutorial-en.csv)
   in a spreadsheet application (Excel, LibreOffice Calc, Google Sheets) — or
   any plain-text editor.
2. Find the `key` for the string you want to update (e.g. `tutorial.T3.body`)
   and edit its `text` cell.
3. Save the file as **CSV UTF-8** (see [Spreadsheet save rules](#spreadsheet-save-rules)
   below for quoting guidance).
4. Rebuild/redeploy — the change takes effect after the normal build (the CSV
   is bundled at build time, not fetched at runtime).

**Spreadsheet save rules**

- Keep the `key,text` header exactly as-is — do not rename, reorder, or delete columns.
- Values containing a comma, a double quote, or a newline must be wrapped in
  double quotes; an embedded double quote is escaped by doubling it (`""`).
  Every mainstream spreadsheet writes RFC4180 quoting automatically when saving
  as CSV.
- Save with **UTF-8** encoding. A leading UTF-8 BOM is tolerated (the loader
  strips it), but avoid adding one if your editor offers the choice.
- Do not add trailing blank rows or extra columns; the integrity test validates
  the exact key set.
- Keep placeholder tokens (`{cardName}`, `{cost}`, `{bonus}`,
  `{synergyCardName}`) in the same positions — do not translate or rename them.

**Never hardcode card facts.** If the text references a card's name, cost, or
income bonus, keep the `{cardName}` / `{cost}` / `{bonus}` placeholder tokens
in place and let the resolver inject the live values from `card-data.csv`.
Hardcoding a value (e.g. writing `€400` or `Laundromat` directly) will go stale
whenever the card is rebalanced.  Do not change a card's name or price in
the tutorial text — change `card-data.csv` instead; the tutorial follows
automatically.

For offer modal or button label changes:

1. Open [`i18n/tutorial-en.csv`](../../src/i18n/tutorial-en.csv)
   in your spreadsheet editor.
2. Find the relevant `tutorial.modal.*` or `tutorial.overlay.*` row.
3. Update the `text` cell and save as CSV UTF-8.
4. Rebuild/redeploy.

### Verification

Run the i18n tests to confirm all keys resolve:

```bash
npx vitest run tests/main-street/tutorial-csv.test.ts
npx vitest run tests/main-street/tutorial-i18n.test.ts
npx vitest run tests/main-street/tutorial-text-updates.test.ts
npx vitest run tests/main-street/tutorial-flow.test.ts
```

The build will also fail if any step key is missing from the English bundle.

## Adding a New Language

Locale bundles can be supplied either as a **CSV** (recommended — same
spreadsheet workflow as English) or as a hand-written TypeScript module.
Both build a `Record<string, string>` keyed by the same `tutorial.*` keys.

### Option A — CSV locale (spreadsheet-friendly)

1. Copy [`i18n/tutorial-en.csv`](../../src/i18n/tutorial-en.csv)
   to `src/i18n/tutorial-fr.csv`.
2. Translate the `text` column, keeping the `key` column unchanged and
   preserving every placeholder token in the same positions.
3. Add a thin loader that reuses the exported CSV parser:

   ```ts
   import rawCsv from './tutorial-fr.csv?raw';
   import { parseTutorialCsv } from './tutorial-en';

   export const TUTORIAL_FR_BUNDLE: Record<string, string> = parseTutorialCsv(rawCsv);
   ```

### Option B — TypeScript locale

1. Create a new locale bundle file, e.g. `src/i18n/tutorial-fr.ts`:

   ```ts
   import { tutorialKey } from './tutorial-en';

   export const TUTORIAL_FR_BUNDLE: Record<string, string> = {
     [tutorialKey('T1', 'title')]: 'Bienvenue à Main Street',
     [tutorialKey('T1', 'body')]: 'Construisez la meilleure rue...',
     // ... all other steps
   };
   ```

   **Keep placeholder tokens in translated strings.**  Any step that uses
   `{cardName}` / `{cost}` / `{bonus}` / `{synergyCardName}` in English must keep
   the same tokens in the same positions in the translation — the resolver
   substitutes the live card-data values regardless of locale.  The surrounding
   prose can be translated freely; the tokens themselves must match exactly.

### Register and activate the locale

2. Register the bundle at a suitable startup point. The overlay manager
   currently registers English at module load time. You can register additional
   locales alongside it, or switch the active locale based on a user setting:

   ```ts
   import { registerLocale } from '@core-engine/I18n';
   import { TUTORIAL_FR_BUNDLE } from '../i18n/tutorial-fr';

   registerLocale('fr', TUTORIAL_FR_BUNDLE);
   ```

3. Switch the active locale:

   ```ts
   import { setLocale } from '@core-engine/I18n';
   setLocale('fr');
   ```

   All tutorial `t(key)` calls will now resolve to the French bundle.
   Any keys not present in the French bundle will fall back to English.

### Partial translations

Locale bundles can be partial — missing keys automatically fall back to
the English bundle. This lets translators incrementally localise steps
without needing to provide every string upfront.

Example (French with only T1 translated):

```ts
registerLocale('fr', {
  [tutorialKey('T1', 'title')]: 'Bienvenue à Main Street',
});
setLocale('fr');
t(tutorialKey('T1', 'title')); // → 'Bienvenue à Main Street'
t(tutorialKey('T2', 'title')); // → 'The Market Row' (English fallback)
```

> **Note:** fallback strings that contain placeholder tokens (e.g. a partial
> French bundle falling back to the English T3 body) are still interpolated
> with live card data — placeholder resolution happens after the locale
> lookup, so card facts are always current regardless of which locale bundle
> supplied the string.

## Test Coverage

The following test files cover tutorial localization:

| Test file | What it verifies |
|-----------|-----------------|
| `tests/main-street/tutorial-csv.test.ts` | CSV integrity: `key,text` header, exactly 65 required keys, no duplicates/orphans, no empty values, comma/quote round-trip, BOM tolerance, placeholder preservation |
| `tests/main-street/tutorial-i18n.test.ts` | All keys exist in English bundle; locale switching; `resolveTutorialStepText()` correctness; per-locale placeholder interpolation |
| `tests/main-street/tutorial-text-updates.test.ts` | Data-driven text content (T3 cost matches `card-data.csv`; no raw `{token}` text; changed cost ⇒ updated text; deterministic resolution; T7/T8/T9 placeholders) |
| `tests/main-street/tutorial-flow.test.ts` | Step definitions have non-empty `titleKey`/`bodyKey`; `resolveTutorialStepText()` returns non-empty text |
| `tests/core-engine/I18n.test.ts` | Core `t(key, params)` interpolation: substitution, missing-placeholder failure, locale fallback |

## Overview of Relevant Files

| File | Purpose |
|------|---------|
| `src/TutorialFlow.ts` | Step definitions (keys + `requiredCardId`/`referencedCardId`), controller logic, `resolveTutorialStepText()` data-driven resolution |
| `src/i18n/tutorial-en.csv` | **Source of truth** — spreadsheet-editable `key,text` CSV holding all 65 English tutorial/modal/overlay/banking/Steam-follow strings; `{cardName}`/`{cost}`/`{bonus}`/`{synergyCardName}` placeholders for card facts |
| `src/i18n/tutorial-en.ts` | Thin loader: `?raw` CSV import + `parseCsv()` + BOM strip → `TUTORIAL_EN_BUNDLE`; exports the `tutorialKey`/`modalKey`/`overlayKey`/`bankingHintKey` helpers. Contains no copy |
| `src/MainStreetCards.ts` | Live card templates parsed from `card-data.csv` (`getCsvRows()`, `getBaseTypeId()`) |
| `src/scenes/MainStreetTutorialHints.ts` | Overlay manager — resolves via `resolveTutorialStepText()` at render time (DOM + Phaser) |
| `core/src/core-engine/I18n.ts` | Core i18n lookup + `t(key, params)` placeholder interpolation |
| `tests/main-street/tutorial-i18n.test.ts` | i18n-specific test coverage |
| `tests/core-engine/I18n.test.ts` | Interpolation unit tests |
