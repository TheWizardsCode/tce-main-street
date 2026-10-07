/**
 * Main Street: Card Test Framework — card fixture resolution.
 *
 * Resolves an engine card template for a given CSV row id using the
 * production deck factories (never a re-implementation of the CSV parser).
 * The deck factories append a serial suffix to ids, so the resolved copy is
 * re-keyed to the base id from the CSV.
 *
 * @module
 */

import {
  createBusinessDeck,
  createCommunitySpaceDeck,
  createEventDeck,
  createStaffDeck,
  createUpgradeDeck,
  type AnyCard,
  type BusinessCard,
  type CardFamily,
  type CommunitySpaceCard,
} from '../../../../src/MainStreetCards';

/** Deterministic RNG used only to satisfy the deck factory signature. */
const deterministicRng = (): number => 0.5;

/**
 * Resolves a fresh engine template instance for a card id and family.
 *
 * @param id     Base card id (CSV `id`).
 * @param family Card family (CSV `family`).
 * @returns A fresh card instance keyed by the base id.
 * @throws When no template exists for the id (guards against a stale CSV row).
 */
export function resolveCardTemplate(id: string, family: CardFamily): AnyCard {
  let card: AnyCard | undefined;
  switch (family) {
    case 'business':
      card = createBusinessDeck(1, [id])[0];
      break;
    case 'community-space':
      card = createCommunitySpaceDeck(1, [id])[0];
      break;
    case 'upgrade':
      card = createUpgradeDeck(1, [id])[0];
      break;
    case 'staff':
      card = createStaffDeck(1, [id])[0];
      break;
    case 'event':
      card = createEventDeck(1, [id], deterministicRng, 1)[0];
      break;
    default: {
      const never: never = family;
      throw new Error(`Unknown card family: ${String(never)}`);
    }
  }
  if (!card) {
    throw new Error(`No ${family} template found for card id '${id}'.`);
  }
  // The factories append a serial suffix (`${id}-0`); restore the base id.
  return { ...card, id } as AnyCard;
}

/** All business and community-space templates (base ids, un-suffixed names). */
export function getAllPlacedTemplates(): (BusinessCard | CommunitySpaceCard)[] {
  return [...createBusinessDeck(1), ...createCommunitySpaceDeck(1)];
}

/**
 * Finds the primary placeable template whose display name matches
 * `name` (used to resolve an upgrade's `targetBusiness`).
 */
export function findPlacedTemplateByName(
  name: string,
): BusinessCard | CommunitySpaceCard | undefined {
  return getAllPlacedTemplates().find(card => card.name === name);
}

/**
 * Finds a placeable template whose synergy types intersect `synergy`
 * (used to give a `SpecificSynergy` event a valid target population).
 */
export function findPlacedTemplateBySynergy(
  synergy: string,
): BusinessCard | CommunitySpaceCard | undefined {
  return getAllPlacedTemplates().find(card =>
    (card.synergyTypes as readonly string[]).includes(synergy),
  );
}

/** True when the card is placeable on the street grid. */
export function isPlaceable(
  card: AnyCard,
): card is BusinessCard | CommunitySpaceCard {
  return card.family === 'business' || card.family === 'community-space';
}
