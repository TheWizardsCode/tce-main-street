/**
 * Main Street: Card Test Framework — shared types.
 *
 * A card test definition is a small, explicit unit that a card must have in
 * order to be considered covered. The framework discovers every card in
 * `src/card-data.csv`, resolves its definition by card id, runs it against a
 * real engine state, and records a pass/fail result back into the CSV.
 *
 * @module
 */

import type { AnyCard, CardFamily, StaffCard } from '../../../src/MainStreetCards';
import type { MainStreetState } from '../../../src/MainStreetState';

/** A single parsed row of `src/card-data.csv` plus its family metadata. */
export interface CardRow {
  /** Stable card id (CSV `id` column). */
  readonly id: string;
  /** Card family (CSV `family` column). */
  readonly family: CardFamily;
  /** Human-readable card name (CSV `name` column). */
  readonly name: string;
  /** The raw parsed CSV row, keyed by column name. */
  readonly row: Record<string, string>;
}

/** Outcome of running a card's definition. */
export type CardTestStatus = 'pass' | 'fail';

/** Result recorded for one card. */
export interface CardTestResult {
  readonly cardId: string;
  readonly status: CardTestStatus;
  /** Concise failure note; empty string on pass. */
  readonly failReason: string;
}

/** Context handed to a card definition's `run` function. */
export interface CardTestContext {
  /** The discovered CSV row for this card. */
  readonly row: CardRow;
  /** The resolved engine template for this card (fresh instance). */
  readonly card: AnyCard;
  /**
   * Factory for the controlled engine state a runner drives. The unit runner
   * defaults to {@link newGame}; the browser suite injects a factory that also
   * installs the state into the live `MainStreetScene`.
   */
  readonly createState: (seed: string) => MainStreetState;
}

/**
 * A card definition's executable body. It must drive the real engine and
 * throw an `Error` (with an actionable message) when the card's declared
 * behaviour is not observed.
 */
export type CardRunner = (context: CardTestContext) => void;

/** A registered, per-card test definition. */
export interface CardDefinition {
  /** The card id this definition covers (must match a CSV row id). */
  readonly cardId: string;
  /** Card family, used for reporting and routing. */
  readonly family: CardFamily;
  /** Short description of what the definition verifies. */
  readonly verifies: string;
  /** Executable body (uses the real engine; throws on failure). */
  readonly run: CardRunner;
}

/**
 * A cross-card combination check applicable to a staff card. Each staff card
 * is covered by up to three of these, selected by {@link appliesTo}.
 */
export interface StaffCombination {
  /** Stable id of the combination scenario. */
  readonly id: string;
  /** Human-readable title (used in the test name). */
  readonly title: string;
  /** Whether this combination applies to the given staff card. */
  readonly appliesTo: (card: StaffCard) => boolean;
  /** Executable body (throws on failure). Returns the state it drove. */
  readonly run: (
    card: StaffCard,
    createState?: (seed: string) => MainStreetState,
  ) => MainStreetState;
}
