/**
 * Main Street Tutorial — English locale bundle.
 *
 * All user-facing string values are sourced from
 * `tutorial-en.csv` (spreadsheet-editable).  This module:
 *
 *  1. Bundles the CSV at build time via Vite `?raw`.
 *  2. Parses it with the core `parseCsv()` helper.
 *  3. Strips a leading UTF-8 BOM (if present) before parsing the header.
 *  4. Exports the same `TUTORIAL_EN_BUNDLE` plus key helpers so that
 *     gameplay code and existing tests are unchanged.
 *
 * The i18n keys follow these conventions:
 * - Step text: `tutorial.<stepId>.title` and `tutorial.<stepId>.body`
 * - Modal: `tutorial.modal.<field>`
 * - Overlay: `tutorial.overlay.<field>`
 * - Banking hint: `tutorial.bankingHint.<field>`
 *
 * ## Editorial rules (26-step flow, two-turn plan-ahead)
 *
 * - **≤3 sentences per text box** (titles and bodies), exactly one point per box.
 * - Do NOT mention time-limited play (the "25 turns" sentence was removed).
 * - Do NOT describe incident cards as "blue" or list their impacts.
 * - Do NOT mention matching cards in the Place a Business step.
 * - Do NOT promise same-turn placement at listed cost: every purchase is a
 *   two-turn flow (CG-0MT53NXGZ004H5AE) — move to hand this week (one action),
 *   End Turn, place next week at LISTED cost. Same-week placement after a move
 *   costs the +50% premium (CG-0MT24X0SX007RLHN) and is never scripted.
 *
 * ## Card-data placeholders
 *
 * Step bodies that reference card facts (name, cost, income bonus) MUST use
 * `{cardName}` / `{cost}` / `{bonus}` / `{synergyCardName}` placeholders instead
 * of hardcoded values.  `resolveTutorialStepText()` in `TutorialFlow.ts`
 * substitutes the live values from `card-data.csv` at render time, so
 * rebalancing card data never leaves the tutorial stale.  Never hardcode a
 * card name, cost, or income figure in a step string.
 *
 * Placeholders resolved from card data:
 * - `{cardName}` — the card's `name` column.
 * - `{cost}` — the card's `cost` column, formatted via `formatCurrency()`.
 * - `{bonus}` — an event card's `coinDelta` as `+N coins` (used by T9).
 * - `{synergyCardName}` — a second card's name, when the step references a
 *   synergy partner (used by T19: Library next to Bookshop).
 *
 * To add a new language variant:
 *  1. Create `tutorial-<lang>.ts` with the translated bundle (keeping the
 *     same placeholder tokens in the same positions).
 *  2. Import and call `registerLocale('<lang>', bundle)` at startup.
 *
 * @module
 */

import { parseCsv } from '@core-engine/CsvLoader';
import rawCsv from './tutorial-en.csv?raw';

// ── Key prefix ────────────────────────────────────────────────

/**
 * The i18n key prefix for tutorial step strings.
 * Each step's title is at `${KEY_PREFIX}.<stepId>.title`
 * Each step's body  is at `${KEY_PREFIX}.<stepId>.body`
 *
 * Offer modal keys:
 *   ${KEY_PREFIX}.modal.title
 *   ${KEY_PREFIX}.modal.body
 *   ${KEY_PREFIX}.modal.skipBtn
 *   ${KEY_PREFIX}.modal.startBtn
 *
 * Overlay button keys:
 *   ${KEY_PREFIX}.overlay.dismiss
 *   ${KEY_PREFIX}.overlay.next
 *   ${KEY_PREFIX}.overlay.exit
 *   ${KEY_PREFIX}.overlay.startFullGame
 *
 * Banking hint keys:
 *   ${KEY_PREFIX}.bankingHint.title
 *   ${KEY_PREFIX}.bankingHint.body
 */
export const TUTORIAL_I18N_KEY_PREFIX = 'tutorial';

// ── Key helper functions ──────────────────────────────────────

/**
 * Build the i18n key for a tutorial step's title or body.
 * @example `tutorialKey('T3', 'title')` → `'tutorial.T3.title'`
 */
export function tutorialKey(stepId: string, field: 'title' | 'body'): string {
  return `${TUTORIAL_I18N_KEY_PREFIX}.${stepId}.${field}`;
}

/**
 * Helper to build keys for tutorial modal strings.
 * @example `modalKey('title')` → `'tutorial.modal.title'`
 */
export function modalKey(field: string): string {
  return `${TUTORIAL_I18N_KEY_PREFIX}.modal.${field}`;
}

/**
 * Helper to build keys for tutorial overlay button labels.
 * @example `overlayKey('dismiss')` → `'tutorial.overlay.dismiss'`
 */
export function overlayKey(field: string): string {
  return `${TUTORIAL_I18N_KEY_PREFIX}.overlay.${field}`;
}

/**
 * Helper to build keys for tutorial banking-hint strings.
 * @example `bankingHintKey('title')` → `'tutorial.bankingHint.title'`
 */
export function bankingHintKey(field: string): string {
  return `${TUTORIAL_I18N_KEY_PREFIX}.bankingHint.${field}`;
}

// ── CSV loader ────────────────────────────────────────────────

/**
 * English locale bundle for all tutorial strings, loaded from CSV.
 *
 * Maps i18n keys (e.g. `tutorial.T1.title`) to English string values.
 * The CSV is bundled at build time via Vite `?raw` import.
 */

/**
 * Strip a leading UTF-8 BOM (EF BB BF) from a string.
 * `parseCsv` does not trim header cells, so a BOM would corrupt
 * the first column name unless we strip it first.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse a tutorial CSV string into an i18n bundle.
 *
 * Strips a leading UTF-8 BOM before parsing (see {@link stripBom}), then maps
 * each `key,text` row into the bundle record. Exported so the CSV-integrity
 * test can assert BOM tolerance directly, and so additional locale loaders
 * can reuse the same logic.
 *
 * @param csvText - Full CSV text (header + data rows).
 * @returns Map of i18n key → text value.
 */
export function parseTutorialCsv(csvText: string): Record<string, string> {
  const bundle: Record<string, string> = {};
  for (const row of parseCsv(stripBom(csvText))) {
    bundle[row.key] = row.text;
  }
  return bundle;
}

export const TUTORIAL_EN_BUNDLE: Record<string, string> = parseTutorialCsv(rawCsv);
