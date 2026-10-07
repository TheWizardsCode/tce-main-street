/**
 * Main Street: Card Test Framework — registry.
 *
 * Discovers every card in `src/card-data.csv`, resolves its explicit test
 * definition, and runs it against a deterministic engine state. A card with
 * no registered definition is reported as a FAILURE — never silently skipped.
 *
 * @module
 */

import { getCsvRows } from '../../../src/MainStreetCards';
import type { CardFamily } from '../../../src/MainStreetCards';
import type {
  CardDefinition,
  CardRow,
  CardTestContext,
  CardTestResult,
} from './CardTestTypes';
import { resolveCardTemplate } from './helpers/cardFixture';
import { CARD_DEFINITIONS } from './definitions';

/** Normalises an unknown thrown value into a concise failure note. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Registry of per-card test definitions.
 *
 * ```ts
 * const registry = createDefaultRegistry();
 * const rows = registry.discoverCards();
 * const results = registry.runAll();
 * ```
 */
export class CardTestRegistry {
  private readonly definitions = new Map<string, CardDefinition>();

  /** Registers a definition; duplicate card ids are an error. */
  register(definition: CardDefinition): void {
    if (this.definitions.has(definition.cardId)) {
      throw new Error(`Duplicate card test definition for '${definition.cardId}'.`);
    }
    this.definitions.set(definition.cardId, definition);
  }

  /** Whether a definition is registered for `cardId`. */
  has(cardId: string): boolean {
    return this.definitions.has(cardId);
  }

  /** Returns the definition for `cardId`, or undefined. */
  get(cardId: string): CardDefinition | undefined {
    return this.definitions.get(cardId);
  }

  /** All registered definitions, in registration order. */
  listDefinitions(): CardDefinition[] {
    return [...this.definitions.values()];
  }

  /** Number of registered definitions. */
  get size(): number {
    return this.definitions.size;
  }

  /** Discovers every card row in `src/card-data.csv`, preserving row order. */
  discoverCards(): CardRow[] {
    return getCsvRows().map(row => ({
      id: row.id,
      family: row.family as CardFamily,
      name: row.name,
      row,
    }));
  }

  /**
   * Returns the ids of discovered cards that have no registered definition.
   *
   * @param cards Optional card rows to check (defaults to all discovered).
   */
  missingDefinitions(cards?: CardRow[]): string[] {
    const rows = cards ?? this.discoverCards();
    return rows.filter(row => !this.definitions.has(row.id)).map(row => row.id);
  }

  /**
   * Runs the definition for one card.
   *
   * A missing definition is reported as a failure rather than skipped.
   */
  runCard(row: CardRow): CardTestResult {
    const definition = this.definitions.get(row.id);
    if (!definition) {
      return {
        cardId: row.id,
        status: 'fail',
        failReason: `No test definition registered for card '${row.id}' (${row.family}).`,
      };
    }

    let context: CardTestContext;
    try {
      context = { row, card: resolveCardTemplate(row.id, row.family) };
    } catch (error) {
      return { cardId: row.id, status: 'fail', failReason: describeError(error) };
    }

    try {
      definition.run(context);
      return { cardId: row.id, status: 'pass', failReason: '' };
    } catch (error) {
      return { cardId: row.id, status: 'fail', failReason: describeError(error) };
    }
  }

  /** Runs every discovered card's definition, in CSV row order. */
  runAll(): CardTestResult[] {
    return this.discoverCards().map(row => this.runCard(row));
  }
}

/** Builds a registry pre-populated with the explicit definitions for every card. */
export function createDefaultRegistry(): CardTestRegistry {
  const registry = new CardTestRegistry();
  for (const definition of CARD_DEFINITIONS) {
    registry.register(definition);
  }
  return registry;
}
