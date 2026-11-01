/**
 * Main Street's story-line **content adapter** for the core authoring toolkit.
 *
 * The core story-line editor (`npm run storylines:editor` in
 * Tableau-Card-Engine) loads a game's content CSV through a declarative
 * `ContentAdapter`: it maps the game's own column names onto the generic
 * story-line fields and exposes the game's extra columns as editable fields.
 * Main Street ships that mapping here, so the core editor can load, inspect and
 * edit `src/card-data.csv` directly.
 *
 * This is **plain data plus two pure hooks** — no Main Street runtime types, no
 * Phaser, and no value import from the core package. The only core reference is
 * a type-only import, which the TypeScript compiler erases, so the core editor
 * can `import()` this module across repository boundaries by path (the game's
 * `@story-line/*` path alias is not resolvable from the core checkout at
 * runtime).
 *
 * It is deliberately distinct from {@link ./MainStreetStorylineAdapter} (the
 * *runtime* seam that compiles event cards into the generic story-line system):
 * this adapter is authoring-side content mapping only.
 *
 * Main Street already writes the generic `options` encoding
 * (`Accept|;Reject|evt-tax-inquiry`), so no translation layer is needed — the
 * generic `compileContentOptions` decodes the same encoding at runtime.
 *
 * @module
 */

import type { ContentAdapter, ContentCard } from '@story-line/content/types';

/**
 * The event columns Main Street consumes when resolving an incident.
 *
 * These are the adapter's extra **editable** columns: everything a designer may
 * want to tune on a story-line card that is not part of the generic story-line
 * field mapping. They mirror the `EventCard` model (`MainStreetCardsTypes.ts`)
 * and the `card-data.csv` header.
 */
export const MAIN_STREET_EVENT_COLUMNS = [
  'trigger',
  'cost',
  'tier',
  'target',
  'targetSynergy',
  'coinDelta',
  'reputationDelta',
  'coinPercentDelta',
  'duration',
  'effectType',
  'multiplier',
  'availableWeekStart',
  'availableWeekEnd',
] as const;

/** Formats a signed integer with a typographic minus, as the core adapters do. */
function signed(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`;
}

/**
 * Main Street's content adapter for `src/card-data.csv`.
 *
 * Main Street keeps every card in one CSV, so the adapter maps the whole file:
 * story-line rows (which carry `storylineId`) form the graph, and every other
 * card (businesses, upgrades, staff, community spaces) appears in the editor's
 * "Ungrouped" bucket rather than being dropped.
 */
export const MAIN_STREET_CONTENT_ADAPTER: ContentAdapter = {
  gameId: 'main-street',
  columns: [
    // The generic story-line fields, in `card-data.csv` order.
    'id',
    'name',
    'effect',
    'options',
    'hasChoices',
    'acceptNextCardId',
    'rejectNextCardId',
    'storylineId',
    'storylineTitle',
    ...MAIN_STREET_EVENT_COLUMNS,
  ],
  fields: {
    id: 'id',
    name: 'name',
    effect: 'effect',
    options: 'options',
    hasChoices: 'hasChoices',
    acceptNextCardId: 'acceptNextCardId',
    rejectNextCardId: 'rejectNextCardId',
    storylineId: 'storylineId',
    storylineTitle: 'storylineTitle',
  },
  editableColumns: MAIN_STREET_EVENT_COLUMNS,
  newCardDefaults: {
    options: '',
    hasChoices: 'false',
    acceptNextCardId: '',
    rejectNextCardId: '',
    storylineId: '',
    storylineTitle: '',
    trigger: 'Incident',
    cost: '0',
    tier: '1',
    target: 'All',
    targetSynergy: '',
    coinDelta: '0',
    reputationDelta: '0',
    coinPercentDelta: '',
    duration: '',
    effectType: '',
    multiplier: '',
    availableWeekStart: '',
    availableWeekEnd: '',
  },
  describeImpact: (card: ContentCard): string => {
    const parts: string[] = [];

    const coins = Number(card.fields.coinDelta ?? '');
    if (Number.isFinite(coins) && coins !== 0) parts.push(`${signed(coins)} coins`);

    const reputation = Number(card.fields.reputationDelta ?? '');
    if (Number.isFinite(reputation) && reputation !== 0) {
      parts.push(`${signed(reputation)} reputation`);
    }

    // A proportional coin effect (e.g. −0.45 = "lose 45% of banked coins")
    // takes precedence over the flat delta at resolution time, so it leads.
    const percent = Number(card.fields.coinPercentDelta ?? '');
    if (Number.isFinite(percent) && percent !== 0) {
      const amount = Math.round(Math.abs(percent) * 100);
      parts.unshift(`${percent < 0 ? '−' : '+'}${amount}% coins`);
    }

    // Income-multiplier incidents (recession, outbreak, …): "70% for 4 turns".
    const multiplier = Number(card.fields.multiplier ?? '');
    if (Number.isFinite(multiplier) && multiplier !== 0 && multiplier !== 1) {
      const duration = Number(card.fields.duration ?? '');
      const turns =
        Number.isFinite(duration) && duration > 0
          ? ` for ${duration} turn${duration === 1 ? '' : 's'}`
          : '';
      parts.push(`${Math.round(multiplier * 100)}% income${turns}`);
    }

    return parts.join(' · ');
  },
};

export default MAIN_STREET_CONTENT_ADAPTER;
